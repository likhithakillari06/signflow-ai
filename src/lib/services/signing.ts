import "server-only";
import { z } from "zod";
import { AUDIT_LABEL, recordAudit } from "../audit";
import { asSystem, getSql } from "../db";
import { sendAdminSignedEmail, sendSignedCopyEmail } from "../email";
import { formatSignedDate, submittedValueSchema, validateSubmission, type FieldDef } from "../fields";
import { FinalizeError, buildSignedPdf } from "../pdf/finalize";
import { withinRateLimit } from "../rate-limit";
import { SIGNABLE_STATUSES, type AgreementStatus } from "../status";
import { StorageError, createSignedUrl, downloadFile, safeFileName, uploadFile } from "../storage";
import { hashToken, isExpired, looksLikeToken, sha256Hex } from "../tokens";

export const CONSENT_TEXT =
  "I have read this document. I agree to sign it electronically, and I understand my electronic signature is intended to have the same effect as a handwritten signature.";

/** How long after signing the signer's link still lets them download their copy. */
export const SIGNER_DOWNLOAD_DAYS = 30;

export type LinkState = "invalid" | "revoked" | "cancelled" | "expired" | "completed" | "unavailable" | "open";

type Resolved = {
  request_id: string; request_status: string; expires_at: Date; completed_at: Date | null; first_viewed_at: Date | null;
  signer_name: string; signer_email: string;
  agreement_id: string; workspace_id: string; case_id: string; title: string; agreement_status: AgreementStatus;
  original_storage_path: string; original_sha256: string; completed_storage_path: string | null; page_count: number;
  workspace_name: string;
};

function stateOf(r: Resolved | undefined): LinkState {
  if (!r) return "invalid";
  if (r.request_status === "completed" && r.agreement_status === "signed") return "completed";
  if (r.agreement_status === "cancelled") return "cancelled";
  if (r.request_status === "revoked") return "revoked";
  if (r.request_status === "expired" || isExpired(r.expires_at)) return "expired";
  if (!SIGNABLE_STATUSES.includes(r.agreement_status)) return "unavailable";
  return "open";
}

/** Looks a link up by the hash of its token. Everything returned is scoped to that one request. */
async function resolve(token: unknown): Promise<Resolved | undefined> {
  if (!looksLikeToken(token)) return undefined;
  const [row] = await getSql()<Resolved[]>`
    select r.id as request_id, r.status as request_status, r.expires_at, r.completed_at, r.first_viewed_at,
           r.signer_name, r.signer_email,
           a.id as agreement_id, a.workspace_id, a.case_id, a.title, a.status as agreement_status,
           a.original_storage_path, a.original_sha256, a.completed_storage_path, a.page_count,
           w.name as workspace_name
      from signing_requests r
      join agreements a on a.id = r.agreement_id
      join workspaces w on w.id = a.workspace_id
     where r.token_hash = ${hashToken(token)}`;
  return row;
}

export type SigningSession =
  | { state: Exclude<LinkState, "open" | "completed">; workspaceName?: string }
  | { state: "completed"; workspaceName: string; title: string; signerName: string; completedAt: string; downloadAvailable: boolean }
  | {
      state: "open"; workspaceName: string; title: string; signerName: string; pageCount: number;
      fields: FieldDef[]; expiresAt: string; consentText: string;
    };

export type ClientInfo = { ip: string | null; userAgent: string | null };

function downloadStillAllowed(completedAt: Date | null): boolean {
  if (!completedAt) return false;
  return Date.now() - new Date(completedAt).getTime() < SIGNER_DOWNLOAD_DAYS * 86_400_000;
}

/** Called when the signing page is opened. Records the first view. */
export async function openSigningSession(token: string, client: ClientInfo): Promise<SigningSession | { state: "rate_limited" }> {
  if (!(await withinRateLimit(`sign:open:${client.ip ?? "unknown"}`, 60))) return { state: "rate_limited" };
  const r = await resolve(token);
  const state = stateOf(r);
  if (!r || state === "invalid") return { state: "invalid" };
  if (state === "completed") {
    return {
      state, workspaceName: r.workspace_name, title: r.title, signerName: r.signer_name,
      completedAt: new Date(r.completed_at!).toISOString(), downloadAvailable: downloadStillAllowed(r.completed_at),
    };
  }
  if (state !== "open") return { state, workspaceName: r.workspace_name };

  if (!r.first_viewed_at) {
    await asSystem(async (tx) => {
      const [first] = await tx`
        update signing_requests set status = 'viewed', first_viewed_at = now()
         where id = ${r.request_id} and status = 'pending' and first_viewed_at is null returning id`;
      if (!first) return;
      await tx`update agreements set status = 'viewed' where id = ${r.agreement_id} and status = 'sent'`;
      await recordAudit(tx, {
        workspaceId: r.workspace_id, agreementId: r.agreement_id, requestId: r.request_id, type: "agreement_viewed",
        actorType: "signer", actorId: r.signer_email, metadata: { ip: client.ip, user_agent: client.userAgent },
      });
    });
  }

  const fields = await getSql()<FieldDef[]>`
    select id, page_number, field_type, x, y, width, height, required, label
      from signing_fields where agreement_id = ${r.agreement_id} order by page_number, y, x`;
  return {
    state: "open", workspaceName: r.workspace_name, title: r.title, signerName: r.signer_name, pageCount: r.page_count,
    fields: [...fields], expiresAt: new Date(r.expires_at).toISOString(), consentText: CONSENT_TEXT,
  };
}

/**
 * Short-lived URL for the one document this link is allowed to see: the original while the
 * link is open, the signed copy once it is complete. Never anything else.
 */
export async function getSignerDocumentUrl(token: string, client: ClientInfo, download = false): Promise<{ url: string } | { error: string; status: number }> {
  if (!(await withinRateLimit(`sign:doc:${client.ip ?? "unknown"}`, 60))) return { error: "Too many requests. Please wait a minute.", status: 429 };
  const r = await resolve(token);
  const state = stateOf(r);
  if (r && state === "open") {
    return { url: await createSignedUrl(r.original_storage_path, 300, download ? safeFileName(r.title) : undefined) };
  }
  if (r && state === "completed" && r.completed_storage_path && downloadStillAllowed(r.completed_at)) {
    return { url: await createSignedUrl(r.completed_storage_path, 300, download ? safeFileName(r.title, "-signed") : undefined) };
  }
  return { error: "This link cannot be used to access a document.", status: 404 };
}

export const completeInputSchema = z.object({
  values: z.array(submittedValueSchema).max(200),
  consent: z.literal(true),
  timeZone: z.string().max(64).optional(),
});

export type CompleteResult =
  | { ok: true; alreadyCompleted: boolean }
  | { ok: false; code: "invalid" | "closed" | "validation" | "rate_limited" | "failed"; message: string; errors?: { fieldId: string | null; message: string }[] };


/**
 * Finalises a signing. Server-side, idempotent and safe under concurrency:
 *  - the request and agreement rows are locked (SELECT ... FOR UPDATE) for the whole operation,
 *    so a second simultaneous submission waits, then sees "completed" and returns success;
 *  - the signed PDF is written to a deterministic path, so a retry overwrites instead of duplicating;
 *  - the agreement only becomes Signed in the same transaction that records the stored file,
 *    so any failure (PDF generation, storage, database) leaves it unsigned.
 */
export async function completeSigning(token: string, rawInput: unknown, client: ClientInfo, appUrl: string): Promise<CompleteResult> {
  if (!looksLikeToken(token)) return { ok: false, code: "invalid", message: "This signing link is not valid." };
  const tokenHash = hashToken(token);
  if (!(await withinRateLimit(`sign:submit:${tokenHash}`, 10)) || !(await withinRateLimit(`sign:submit-ip:${client.ip ?? "unknown"}`, 30))) {
    return { ok: false, code: "rate_limited", message: "Too many attempts. Please wait a minute and try again." };
  }
  const parsed = completeInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const consentMissing = parsed.error.issues.some((i) => i.path[0] === "consent");
    return { ok: false, code: "validation", message: consentMissing ? "Please tick the box to confirm you agree to sign electronically." : "The submitted form is not valid." };
  }
  const input = parsed.data;

  let notify: { r: Resolved & { case_reference: string; created_by_email: string | null } } | undefined;
  try {
    const result = await asSystem<CompleteResult>(async (tx) => {
      const [r] = await tx<(Resolved & { case_reference: string })[]>`
        select r.id as request_id, r.status as request_status, r.expires_at, r.completed_at, r.first_viewed_at,
               r.signer_name, r.signer_email,
               a.id as agreement_id, a.workspace_id, a.case_id, a.title, a.status as agreement_status,
               a.original_storage_path, a.original_sha256, a.completed_storage_path, a.page_count,
               w.name as workspace_name, c.reference as case_reference
          from signing_requests r
          join agreements a on a.id = r.agreement_id
          join workspaces w on w.id = a.workspace_id
          join cases c on c.id = a.case_id
         where r.token_hash = ${tokenHash}
         for update of r, a`;
      const state = stateOf(r);
      if (!r || state === "invalid") return { ok: false, code: "invalid", message: "This signing link is not valid." };
      if (state === "completed") return { ok: true, alreadyCompleted: true };
      if (state !== "open") {
        const why: Record<string, string> = {
          expired: "This signing link has expired. Please ask the sender for a new one.",
          cancelled: "This agreement was cancelled by the sender.",
          revoked: "This signing link has been replaced. Please use the most recent link you were sent.",
          unavailable: "This agreement is not available for signing right now.",
        };
        return { ok: false, code: "closed", message: why[state] ?? why.unavailable };
      }

      const fields = [...(await tx<FieldDef[]>`
        select id, page_number, field_type, x, y, width, height, required, label
          from signing_fields where agreement_id = ${r.agreement_id} order by page_number, y, x`)];
      const now = new Date();
      const checked = validateSubmission(fields, input.values, formatSignedDate(now, input.timeZone));
      if (!checked.ok) {
        return { ok: false, code: "validation", message: checked.errors[0]?.message ?? "Some required fields are missing.", errors: checked.errors };
      }

      // Always start from the exact original that was uploaded.
      const original = await downloadFile(r.original_storage_path);
      if (sha256Hex(original) !== r.original_sha256) {
        throw new FinalizeError("The stored original no longer matches the document that was uploaded.");
      }

      const history = await tx`select event_type, created_at from audit_events where agreement_id = ${r.agreement_id} order by seq`;
      const stamp = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
      const pdf = await buildSignedPdf({
        original, fields, values: checked.values,
        certificate: {
          agreementTitle: r.title, workspaceName: r.workspace_name, agreementId: r.agreement_id, originalSha256: r.original_sha256,
          signerName: r.signer_name, signerEmail: r.signer_email, signedAtIso: stamp(now), ip: client.ip, userAgent: client.userAgent,
          consentText: CONSENT_TEXT,
          events: [
            ...history.map((e) => ({ at: stamp(new Date(e.created_at)), label: AUDIT_LABEL[e.event_type] ?? e.event_type })),
            { at: stamp(now), label: AUDIT_LABEL.consent_accepted },
            { at: stamp(now), label: AUDIT_LABEL.agreement_signed },
          ],
        },
      });

      const folder = `${r.workspace_id}/agreements/${r.agreement_id}`;
      const completedPath = `${folder}/signed.pdf`;
      for (const v of checked.values) {
        if (v.kind === "image") await uploadFile(`${folder}/signatures/${v.fieldId}.png`, v.png, "image/png", true);
      }
      await uploadFile(completedPath, pdf, "application/pdf", true);
      const completedSha = sha256Hex(pdf);

      for (const v of checked.values) {
        await tx`
          insert into signing_field_values (signing_request_id, signing_field_id, value_type, value, method)
          values (${r.request_id}, ${v.fieldId}, ${v.kind}, ${v.kind === "image" ? `${folder}/signatures/${v.fieldId}.png` : v.text}, ${v.kind === "image" ? v.method : null})`;
      }
      await tx`
        update signing_requests
           set status = 'completed', completed_at = ${now}, consent_at = ${now}, consent_text = ${CONSENT_TEXT},
               signer_ip = ${client.ip}, signer_user_agent = ${client.userAgent}
         where id = ${r.request_id}`;
      await tx`
        update agreements
           set status = 'signed', signed_at = ${now}, completed_storage_path = ${completedPath}, completed_sha256 = ${completedSha}, failure_reason = null
         where id = ${r.agreement_id}`;
      await tx`update cases set status = 'active' where id = ${r.case_id} and status in ('intake', 'awaiting_signature')`;

      const base = { workspaceId: r.workspace_id, agreementId: r.agreement_id, requestId: r.request_id, actorType: "signer" as const, actorId: r.signer_email };
      await recordAudit(tx, { ...base, type: "consent_accepted", metadata: { consent_text: CONSENT_TEXT, ip: client.ip, user_agent: client.userAgent } });
      await recordAudit(tx, {
        ...base, type: "agreement_signed",
        metadata: { ip: client.ip, user_agent: client.userAgent, signature_methods: checked.values.filter((v) => v.kind === "image").map((v) => (v.kind === "image" ? v.method : "")) },
      });
      await recordAudit(tx, { ...base, actorType: "system", actorId: null, type: "completed_document_generated", metadata: { sha256: completedSha, bytes: pdf.length, original_sha256: r.original_sha256 } });

      const [creator] = await tx`select u.email from agreements a join auth.users u on u.id = a.created_by where a.id = ${r.agreement_id}`;
      notify = { r: { ...r, created_by_email: creator?.email ?? null } };
      return { ok: true, alreadyCompleted: false };
    });

    if (result.ok && !result.alreadyCompleted && notify) {
      const n = notify.r;
      await Promise.allSettled([
        sendSignedCopyEmail({ to: n.signer_email, signerName: n.signer_name, workspaceName: n.workspace_name, agreementTitle: n.title, url: `${appUrl}/sign/${token}/complete` }),
        n.created_by_email
          ? sendAdminSignedEmail({ to: n.created_by_email, signerName: n.signer_name, agreementTitle: n.title, caseReference: n.case_reference, url: `${appUrl}/agreements/${n.agreement_id}` })
          : Promise.resolve(),
      ]);
    }
    return result;
  } catch (err) {
    const fixable = err instanceof FinalizeError && /characters|signature image/i.test(err.message);
    if (fixable) return { ok: false, code: "validation", message: (err as Error).message };

    // Generation or storage failed: the transaction rolled back, so the agreement is still
    // unsigned. Record what happened and let the signer try again.
    const reason = err instanceof FinalizeError || err instanceof StorageError ? err.message : "Unexpected error while generating the signed document.";
    console.error("[signing] completion failed:", err instanceof Error ? err.message : err);
    await asSystem(async (tx) => {
      const [a] = await tx`
        update agreements a set status = 'failed', failure_reason = ${reason}
          from signing_requests r
         where r.token_hash = ${tokenHash} and r.agreement_id = a.id and a.status in ('sent', 'viewed', 'failed')
        returning a.id, a.workspace_id, r.id as request_id`;
      if (a) await recordAudit(tx, { workspaceId: a.workspace_id, agreementId: a.id, requestId: a.request_id, type: "completion_failed", actorType: "system", metadata: { reason } });
    }).catch(() => {});
    return { ok: false, code: "failed", message: "We could not finish signing because the signed document could not be saved. Nothing was signed. Please try again in a moment." };
  }
}
