"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContextOrNull } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { getAppUrl } from "@/lib/env";
import { AppError, userMessage } from "@/lib/errors";
import { MAX_PDF_BYTES, PdfValidationError } from "@/lib/pdf/inspect";
import {
  cancelAgreement, createAgreement, createTemplate, issueSigningLink, recallAgreement, saveAgreementSetup, saveTemplateFields,
  type IssuedLink, type PdfSource,
} from "@/lib/services/agreements";
import { loadSampleData } from "@/lib/services/workspace";
import { createSignedUploadUrl } from "@/lib/storage";
import type { ActionResult } from "@/lib/types";

const SIGNED_OUT = "Your session has ended. Please sign in again.";
const uuid = z.string().uuid();
const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

function fail(err: unknown): { ok: false; error: string } {
  if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Please check the form." };
  if (!(err instanceof AppError) && !(err instanceof PdfValidationError)) console.error("[action]", err);
  const pg = err as { code?: string; constraint_name?: string };
  if (pg?.code === "23505" && pg.constraint_name?.includes("reference")) return { ok: false, error: "A file with that reference already exists." };
  return { ok: false, error: userMessage(err) };
}

// ---- Clients ------------------------------------------------------------------------------

const clientSchema = z.object({ name: z.string().trim().min(1, "Enter the client's name.").max(160), email });

export async function createClientAction(input: { name: string; email: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    const data = clientSchema.parse(input);
    const id = await asUser(ctx.user.id, async (tx) => {
      const [row] = await tx`insert into clients (workspace_id, name, email) values (${ctx.workspace.id}, ${data.name}, ${data.email}) returning id`;
      return row.id as string;
    });
    revalidatePath("/clients");
    return { ok: true, data: { id } };
  } catch (err) {
    return fail(err);
  }
}

// ---- Files (cases) ------------------------------------------------------------------------

const caseSchema = z.object({
  clientId: uuid,
  reference: z.string().trim().min(1, "Enter a file reference.").max(60),
  title: z.string().trim().min(1, "Enter a title for the file.").max(200),
  templateId: uuid.nullable(),
  sendNow: z.boolean(),
});

export type CaseCreated = { id: string; agreementId: string | null; link: IssuedLink | null; warning: string | null };

/**
 * Opens a file. With a template selected this is the whole automation in one step: the
 * agreement is created from the template, addressed to the client, and (optionally) sent.
 */
export async function createCaseAction(input: z.input<typeof caseSchema>): Promise<ActionResult<CaseCreated>> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    const data = caseSchema.parse(input);
    const created = await asUser(ctx.user.id, async (tx) => {
      const [row] = await tx`
        insert into cases (workspace_id, client_id, reference, title)
        values (${ctx.workspace.id}, ${data.clientId}, ${data.reference}, ${data.title}) returning id`;
      const [tpl] = data.templateId ? await tx`select name from templates where id = ${data.templateId} and archived_at is null` : [];
      return { id: row.id as string, templateName: (tpl?.name as string | undefined) ?? null };
    });
    revalidatePath("/cases");
    const out: CaseCreated = { id: created.id, agreementId: null, link: null, warning: null };
    if (!data.templateId) return { ok: true, data: out };
    if (!created.templateName) return { ok: true, data: { ...out, warning: "The file was created, but the selected template no longer exists." } };

    try {
      const agreement = await createAgreement({
        userId: ctx.user.id, workspaceId: ctx.workspace.id, caseId: created.id, title: created.templateName,
        source: { kind: "template", templateId: data.templateId },
      });
      out.agreementId = agreement.id;
      if (data.sendNow) {
        if (agreement.status === "ready") {
          out.link = await issueSigningLink({ userId: ctx.user.id, agreementId: agreement.id, appUrl: await getAppUrl(), sendEmail: true });
        } else {
          out.warning = "The agreement was created but not sent: the template has no required signature field yet.";
        }
      }
    } catch (err) {
      out.warning = `The file was created, but the agreement could not be prepared: ${userMessage(err, "unexpected error")}`;
    }
    return { ok: true, data: out };
  } catch (err) {
    return fail(err);
  }
}

// ---- Uploads ------------------------------------------------------------------------------

/** For PDFs too large to pass through the server: a one-time URL to put the file in private storage. */
export async function prepareUploadAction(size: number): Promise<ActionResult<{ path: string; token: string }>> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  if (!Number.isFinite(size) || size <= 0 || size > MAX_PDF_BYTES) return { ok: false, error: "The file is larger than the upload limit." };
  try {
    const slot = await createSignedUploadUrl(`${ctx.workspace.id}/uploads/${randomUUID()}.pdf`);
    return { ok: true, data: slot };
  } catch (err) {
    return fail(err);
  }
}

async function sourceFromForm(form: FormData): Promise<Exclude<PdfSource, { kind: "template" }>> {
  const uploadPath = form.get("uploadPath");
  if (typeof uploadPath === "string" && uploadPath) return { kind: "upload", path: uploadPath };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new AppError("Choose a PDF file to upload.");
  if (file.size > MAX_PDF_BYTES) throw new PdfValidationError("too_large");
  return { kind: "bytes", bytes: new Uint8Array(await file.arrayBuffer()) };
}

// ---- Agreements ---------------------------------------------------------------------------

const title = z.string().trim().min(1, "Enter a title.").max(200);

export async function createAgreementAction(form: FormData): Promise<ActionResult<{ id: string; status: string }>> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    const caseId = uuid.parse(form.get("caseId"));
    const templateId = form.get("templateId");
    const source: PdfSource = typeof templateId === "string" && templateId ? { kind: "template", templateId: uuid.parse(templateId) } : await sourceFromForm(form);
    const result = await createAgreement({ userId: ctx.user.id, workspaceId: ctx.workspace.id, caseId, title: title.parse(form.get("title")), source });
    revalidatePath("/dashboard");
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}

const setupSchema = z.object({
  agreementId: uuid,
  fields: z.array(z.unknown()),
  signer: z.object({ name: z.string().trim().min(1, "Enter the signer's name.").max(160), email }),
});

export async function saveAgreementSetupAction(input: z.input<typeof setupSchema>): Promise<ActionResult<{ status: string; problems: string[] }>> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    const data = setupSchema.parse(input);
    const result = await saveAgreementSetup({ userId: ctx.user.id, agreementId: data.agreementId, fields: data.fields, signer: data.signer });
    revalidatePath(`/agreements/${data.agreementId}`);
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}

export async function issueLinkAction(agreementId: string, sendEmail: boolean): Promise<ActionResult<IssuedLink>> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    const link = await issueSigningLink({ userId: ctx.user.id, agreementId: uuid.parse(agreementId), appUrl: await getAppUrl(), sendEmail });
    revalidatePath(`/agreements/${agreementId}`);
    return { ok: true, data: link };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelAgreementAction(agreementId: string): Promise<ActionResult> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    await cancelAgreement(ctx.user.id, uuid.parse(agreementId));
    revalidatePath(`/agreements/${agreementId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

export async function recallAgreementAction(agreementId: string): Promise<ActionResult> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    await recallAgreement(ctx.user.id, uuid.parse(agreementId));
    revalidatePath(`/agreements/${agreementId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

// ---- Templates ----------------------------------------------------------------------------

export async function createTemplateAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    const result = await createTemplate({ userId: ctx.user.id, workspaceId: ctx.workspace.id, name: title.parse(form.get("title")), source: await sourceFromForm(form) });
    revalidatePath("/templates");
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}

export async function saveTemplateFieldsAction(templateId: string, fields: unknown[]): Promise<ActionResult<{ problems: string[] }>> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    const result = await saveTemplateFields(ctx.user.id, uuid.parse(templateId), fields);
    revalidatePath("/templates");
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}

export async function archiveTemplateAction(templateId: string): Promise<ActionResult> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    await asUser(ctx.user.id, async (tx) => {
      await tx`update workspaces set default_template_id = null where id = ${ctx.workspace.id} and default_template_id = ${uuid.parse(templateId)}`;
      await tx`update templates set archived_at = now() where id = ${templateId}`;
    });
    revalidatePath("/templates");
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

// ---- Settings -----------------------------------------------------------------------------

const settingsSchema = z.object({
  name: z.string().trim().min(2, "Enter your company name.").max(120),
  defaultTemplateId: uuid.nullable(),
  linkExpiryDays: z.number().int().min(1).max(90),
});

export async function updateSettingsAction(input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    const data = settingsSchema.parse(input);
    await asUser(ctx.user.id, async (tx) => {
      // The composite foreign key guarantees the template belongs to this workspace.
      await tx`update workspaces set name = ${data.name}, default_template_id = ${data.defaultTemplateId}, link_expiry_days = ${data.linkExpiryDays} where id = ${ctx.workspace.id}`;
    });
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (err) {
    return fail(err);
  }
}

export async function loadSampleDataAction(): Promise<ActionResult<{ agreementId: string }>> {
  const ctx = await getContextOrNull();
  if (!ctx) return { ok: false, error: SIGNED_OUT };
  try {
    const result = await loadSampleData(ctx.user.id, ctx.workspace.id);
    revalidatePath("/", "layout");
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}
