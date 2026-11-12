import "server-only";
import { randomUUID } from "node:crypto";
import { recordAudit } from "../audit";
import { asSystem, asUser, elevated, type Db } from "../db";
import { isEmailConfigured, sendInvitationEmail, type EmailResult } from "../email";
import { AppError } from "../errors";
import { fieldsInputSchema, validateFieldLayout, type FieldInput } from "../fields";
import { inspectPdf } from "../pdf/inspect";
import { withinRateLimit } from "../rate-limit";
import { EDITABLE_STATUSES, canTransition, type AgreementStatus } from "../status";
import { downloadFile, removeFiles, uploadFile } from "../storage";
import { expiryFromNow, generateSigningToken, hashToken, sha256Hex } from "../tokens";
import type { Agreement, EmailStatus } from "../types";

export type PdfSource =
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "upload"; path: string }
  | { kind: "template"; templateId: string };

const DAILY_EMAIL_CAP = 200;
const UPLOAD_PATH = /^[0-9a-f-]{36}\/uploads\/[0-9a-f-]{36}\.pdf$/;

/** Reads the PDF for a new agreement/template. Direct uploads are validated here, server-side. */
export async function resolveSourceBytes(workspaceId: string, source: Exclude<PdfSource, { kind: "template" }>): Promise<Uint8Array> {
  if (source.kind === "bytes") return source.bytes;
  if (!UPLOAD_PATH.test(source.path) || !source.path.startsWith(`${workspaceId}/uploads/`)) {
    throw new AppError("That upload does not belong to this workspace.");
  }
  try {
    return await downloadFile(source.path);
  } catch {
    throw new AppError("The uploaded file could not be found. Please upload it again.");
  }
}

async function cleanupUpload(source: PdfSource) {
  if (source.kind === "upload") await removeFiles([source.path]).catch(() => {});
}

/**
 * Creates an agreement for a file (case). The PDF is validated, stored unchanged under the
 * workspace's private folder, and every agreement gets its own copy — including ones created
 * from a template — so no two clients ever share a document instance.
 */
export async function createAgreement(p: {
  userId: string;
  workspaceId: string;
  caseId: string;
  title: string;
  source: PdfSource;
}): Promise<{ id: string; status: AgreementStatus }> {
  // 1. Prove (under RLS) that the file — and the template, if any — belong to this user's workspace.
  const pre = await asUser(p.userId, async (tx) => {
    const [c] = await tx`
      select c.id, cl.name as client_name, cl.email as client_email
        from cases c join clients cl on cl.id = c.client_id
       where c.id = ${p.caseId} and c.workspace_id = ${p.workspaceId}`;
    if (!c) throw new AppError("That file was not found in your workspace.");
    if (p.source.kind !== "template") return { c, template: null, templateFields: [] as FieldInput[] };
    const [t] = await tx`select id, storage_path from templates where id = ${p.source.templateId} and workspace_id = ${p.workspaceId} and archived_at is null`;
    if (!t) throw new AppError("That template was not found in your workspace.");
    const templateFields = await tx<FieldInput[]>`
      select page_number, field_type, x, y, width, height, required, label from template_fields where template_id = ${t.id}`;
    return { c, template: t, templateFields: [...templateFields] };
  });

  // 2. Load and validate the document.
  let bytes: Uint8Array;
  if (p.source.kind === "template") {
    bytes = await downloadFile(pre.template!.storage_path);
  } else {
    bytes = await resolveSourceBytes(p.workspaceId, p.source);
  }
  let info;
  try {
    info = await inspectPdf(bytes);
  } catch (err) {
    await cleanupUpload(p.source);
    throw err;
  }

  // 3. Store the original, untouched.
  const id = randomUUID();
  const path = `${p.workspaceId}/agreements/${id}/original.pdf`;
  await uploadFile(path, bytes, "application/pdf");

  // 4. Persist. Agreement rows are written by trusted code only (see migration grants).
  try {
    const layoutOk = p.source.kind === "template" && validateFieldLayout(pre.templateFields, info.pageCount).length === 0;
    const status: AgreementStatus = layoutOk ? "ready" : "draft";
    await asUser(p.userId, async (tx) => {
      const [again] = await tx`select id from cases where id = ${p.caseId} and workspace_id = ${p.workspaceId}`;
      if (!again) throw new AppError("That file was not found in your workspace.");
      await elevated(tx, async () => {
        await tx`
          insert into agreements (id, workspace_id, case_id, template_id, title, original_storage_path, original_sha256, original_size, page_count, status, created_by)
          values (${id}, ${p.workspaceId}, ${p.caseId}, ${pre.template?.id ?? null}, ${p.title}, ${path}, ${sha256Hex(bytes)}, ${bytes.length}, ${info.pageCount}, 'draft', ${p.userId})`;
        const [signer] = await tx`
          insert into agreement_signers (agreement_id, name, email) values (${id}, ${pre.c.client_name}, ${pre.c.client_email}) returning id`;
        for (const f of pre.templateFields) {
          await tx`
            insert into signing_fields (agreement_id, page_number, field_type, x, y, width, height, required, label, assigned_signer_id)
            values (${id}, ${f.page_number}, ${f.field_type}, ${f.x}, ${f.y}, ${f.width}, ${f.height}, ${f.required}, ${f.label ?? null}, ${signer.id})`;
        }
        if (status === "ready") await tx`update agreements set status = 'ready' where id = ${id}`;
        const base = { workspaceId: p.workspaceId, agreementId: id, actorType: "admin" as const, actorId: p.userId };
        await recordAudit(tx, { ...base, type: "agreement_created", metadata: { title: p.title, case_id: p.caseId, from_template: pre.template?.id ?? null } });
        await recordAudit(tx, { ...base, type: "original_uploaded", metadata: { sha256: sha256Hex(bytes), bytes: bytes.length, pages: info.pageCount } });
        if (pre.templateFields.length > 0) {
          await recordAudit(tx, { ...base, type: "fields_configured", metadata: { count: pre.templateFields.length, source: "template" } });
        }
      });
    });
    await cleanupUpload(p.source);
    return { id, status };
  } catch (err) {
    await removeFiles([path]).catch(() => {});
    throw err;
  }
}

export async function createTemplate(p: {
  userId: string;
  workspaceId: string;
  name: string;
  source: Exclude<PdfSource, { kind: "template" }>;
}): Promise<{ id: string }> {
  const bytes = await resolveSourceBytes(p.workspaceId, p.source);
  let info;
  try {
    info = await inspectPdf(bytes);
  } catch (err) {
    await cleanupUpload(p.source);
    throw err;
  }
  const id = randomUUID();
  const path = `${p.workspaceId}/templates/${id}/template.pdf`;
  await uploadFile(path, bytes, "application/pdf");
  try {
    await asUser(p.userId, async (tx) => {
      await tx`
        insert into templates (id, workspace_id, name, storage_path, page_count, file_size, sha256)
        values (${id}, ${p.workspaceId}, ${p.name}, ${path}, ${info.pageCount}, ${bytes.length}, ${sha256Hex(bytes)})`;
    });
  } catch (err) {
    await removeFiles([path]).catch(() => {});
    throw err;
  }
  await cleanupUpload(p.source);
  return { id };
}

export async function saveTemplateFields(userId: string, templateId: string, rawFields: unknown): Promise<{ problems: string[] }> {
  const fields = fieldsInputSchema.parse(rawFields);
  return asUser(userId, async (tx) => {
    const [t] = await tx`select id, page_count from templates where id = ${templateId}`;
    if (!t) throw new AppError("Template not found.");
    if (fields.some((f) => f.page_number > t.page_count)) throw new AppError("A field is placed on a page that does not exist.");
    await tx`delete from template_fields where template_id = ${templateId}`;
    for (const f of fields) {
      await tx`
        insert into template_fields (template_id, page_number, field_type, x, y, width, height, required, label)
        values (${templateId}, ${f.page_number}, ${f.field_type}, ${f.x}, ${f.y}, ${f.width}, ${f.height}, ${f.required}, ${f.label || null})`;
    }
    return { problems: validateFieldLayout(fields, t.page_count) };
  });
}

/** Saves the field layout and signer. Moves the agreement Draft <-> Ready automatically. */
export async function saveAgreementSetup(p: {
  userId: string;
  agreementId: string;
  fields: unknown;
  signer: { name: string; email: string };
}): Promise<{ status: AgreementStatus; problems: string[] }> {
  const fields = fieldsInputSchema.parse(p.fields);
  return asUser(p.userId, async (tx) => {
    const [a] = await tx<Agreement[]>`select * from agreements where id = ${p.agreementId} for share`;
    if (!a) throw new AppError("Agreement not found.");
    if (!EDITABLE_STATUSES.includes(a.status)) {
      throw new AppError("This agreement has already been sent. Recall it first if you need to change the fields.");
    }
    if (fields.some((f) => f.page_number > a.page_count)) throw new AppError("A field is placed on a page that does not exist.");

    const [signer] = await tx`
      insert into agreement_signers (agreement_id, name, email) values (${a.id}, ${p.signer.name}, ${p.signer.email})
      on conflict (agreement_id) do update set name = excluded.name, email = excluded.email
      returning id`;
    await tx`delete from signing_fields where agreement_id = ${a.id}`;
    for (const f of fields) {
      await tx`
        insert into signing_fields (agreement_id, page_number, field_type, x, y, width, height, required, label, assigned_signer_id)
        values (${a.id}, ${f.page_number}, ${f.field_type}, ${f.x}, ${f.y}, ${f.width}, ${f.height}, ${f.required}, ${f.label || null}, ${signer.id})`;
    }
    const problems = validateFieldLayout(fields, a.page_count);
    const status: AgreementStatus = problems.length === 0 ? "ready" : "draft";
    await elevated(tx, async () => {
      if (status !== a.status) await tx`update agreements set status = ${status} where id = ${a.id}`;
      const counts: Record<string, number> = {};
      for (const f of fields) counts[f.field_type] = (counts[f.field_type] ?? 0) + 1;
      await recordAudit(tx, {
        workspaceId: a.workspace_id, agreementId: a.id, type: "fields_configured", actorType: "admin", actorId: p.userId,
        metadata: { count: fields.length, by_type: counts, signer_email: p.signer.email },
      });
    });
    return { status, problems };
  });
}

export type IssuedLink = {
  url: string;
  expiresAt: string;
  emailStatus: EmailStatus;
  emailError: string | null;
  signerEmail: string;
};

/**
 * Creates a fresh signing link (revoking any earlier one), moves the agreement to Sent and,
 * if asked, emails the invitation. The plain token exists only in the returned URL.
 */
export async function issueSigningLink(p: { userId: string; agreementId: string; appUrl: string; sendEmail: boolean }): Promise<IssuedLink> {
  const token = generateSigningToken();
  const created = await asUser(p.userId, async (tx) => {
    const [a] = await tx`
      select a.id, a.workspace_id, a.status, a.title, a.case_id, w.name as workspace_name, w.link_expiry_days,
             s.id as signer_id, s.name as signer_name, s.email as signer_email,
             (select count(*) from signing_fields f where f.agreement_id = a.id and f.field_type = 'signature')::int as signature_fields
        from agreements a
        join workspaces w on w.id = a.workspace_id
        left join agreement_signers s on s.agreement_id = a.id
       where a.id = ${p.agreementId}
       for update of a`;
    if (!a) throw new AppError("Agreement not found.");
    if (a.status === "draft" || a.signature_fields === 0) throw new AppError("Place at least one signature field before sending.");
    if (!a.signer_id) throw new AppError("Add the signer's name and email before sending.");
    if (!canTransition(a.status, "sent")) throw new AppError(`This agreement is ${a.status} and cannot be sent.`);

    const expiresAt = expiryFromNow(a.link_expiry_days);
    return elevated(tx, async () => {
      const revoked = await tx`
        update signing_requests set status = 'revoked' where agreement_id = ${a.id} and status in ('pending', 'viewed') returning id`;
      const [req] = await tx`
        insert into signing_requests (agreement_id, signer_id, signer_name, signer_email, token_hash, expires_at, created_by, email_status)
        values (${a.id}, ${a.signer_id}, ${a.signer_name}, ${a.signer_email}, ${hashToken(token)}, ${expiresAt}, ${p.userId}, 'not_requested')
        returning id`;
      await tx`update agreements set status = 'sent', failure_reason = null where id = ${a.id}`;
      await tx`update cases set status = 'awaiting_signature' where id = ${a.case_id} and status = 'intake'`;
      for (const r of revoked) {
        await recordAudit(tx, { workspaceId: a.workspace_id, agreementId: a.id, requestId: r.id, type: "signing_link_revoked", actorType: "admin", actorId: p.userId, metadata: { reason: "replaced" } });
      }
      await recordAudit(tx, {
        workspaceId: a.workspace_id, agreementId: a.id, requestId: req.id, type: "signing_link_created", actorType: "admin", actorId: p.userId,
        metadata: { signer_email: a.signer_email, expires_at: expiresAt.toISOString(), replaced_previous: revoked.length > 0 },
      });
      return { a, requestId: req.id as string, expiresAt };
    });
  });

  const url = `${p.appUrl}/sign/${token}`;
  const { a, requestId, expiresAt } = created;
  let emailStatus: EmailStatus = "not_requested";
  let emailError: string | null = null;

  if (p.sendEmail) {
    // A per-workspace daily cap keeps an open sign-up page from being used to send bulk email.
    const underCap = await withinRateLimit(`email:workspace:${a.workspace_id}`, DAILY_EMAIL_CAP, 86_400);
    const result: EmailResult = !isEmailConfigured()
      ? { status: "not_configured" }
      : !underCap
        ? { status: "failed", error: `Daily limit of ${DAILY_EMAIL_CAP} invitation emails reached for this workspace.` }
        : await sendInvitationEmail({ to: a.signer_email, signerName: a.signer_name, workspaceName: a.workspace_name, agreementTitle: a.title, url, expiresAt });
    emailStatus = result.status;
    emailError = result.status === "failed" ? result.error : null;
    await asSystem(async (tx) => {
      await tx`
        update signing_requests
           set email_status = ${emailStatus}, email_error = ${emailError},
               email_provider_id = ${result.status === "accepted" ? result.id : null}, email_attempted_at = now()
         where id = ${requestId}`;
      await recordAudit(tx, {
        workspaceId: a.workspace_id, agreementId: a.id, requestId, actorType: "system",
        type: result.status === "accepted" ? "invitation_email_accepted" : result.status === "failed" ? "invitation_email_failed" : "invitation_email_skipped",
        metadata: { to: a.signer_email, ...(emailError ? { error: emailError } : {}), ...(result.status === "accepted" ? { provider_id: result.id } : {}) },
      });
    });
  }

  return { url, expiresAt: expiresAt.toISOString(), emailStatus, emailError, signerEmail: a.signer_email };
}

async function closeOut(p: { userId: string; agreementId: string; to: "cancelled" | "ready" }) {
  return asUser(p.userId, async (tx) => {
    const [a] = await tx<Agreement[]>`select * from agreements where id = ${p.agreementId} for update`;
    if (!a) throw new AppError("Agreement not found.");
    if (!canTransition(a.status, p.to)) throw new AppError(`This agreement is ${a.status} and cannot be ${p.to === "ready" ? "recalled" : "cancelled"}.`);
    await elevated(tx, async () => {
      const revoked = await tx`update signing_requests set status = 'revoked' where agreement_id = ${a.id} and status in ('pending', 'viewed') returning id`;
      await tx`update agreements set status = ${p.to}, failure_reason = null where id = ${a.id}`;
      // The file goes back to intake if nothing else is out for signature on it.
      await tx`
        update cases set status = 'intake'
         where id = ${a.case_id} and status = 'awaiting_signature'
           and not exists (select 1 from agreements x where x.case_id = ${a.case_id} and x.id <> ${a.id} and x.status in ('sent', 'viewed', 'failed'))`;
      await recordAudit(tx, {
        workspaceId: a.workspace_id, agreementId: a.id, actorType: "admin", actorId: p.userId,
        type: p.to === "cancelled" ? "agreement_cancelled" : "agreement_recalled",
        metadata: { previous_status: a.status, links_revoked: revoked.length },
      });
    });
  });
}

export const cancelAgreement = (userId: string, agreementId: string) => closeOut({ userId, agreementId, to: "cancelled" });
export const recallAgreement = (userId: string, agreementId: string) => closeOut({ userId, agreementId, to: "ready" });

/**
 * Marks overdue links (and their agreements) Expired. Runs before agreement data is read, so
 * the stored status is always the truth; it can also be called from a scheduled job.
 */
export async function expireDueAgreements(): Promise<number> {
  return asSystem(async (tx: Db) => {
    const due = await tx`
      update signing_requests r set status = 'expired'
       where r.status in ('pending', 'viewed') and r.expires_at <= now()
      returning r.id, r.agreement_id`;
    for (const r of due) {
      const [a] = await tx`
        update agreements set status = 'expired' where id = ${r.agreement_id} and status in ('sent', 'viewed', 'failed')
        returning id, workspace_id, case_id`;
      if (a) {
        await recordAudit(tx, { workspaceId: a.workspace_id, agreementId: a.id, requestId: r.id, type: "agreement_expired", actorType: "system" });
      }
    }
    return due.length;
  });
}
