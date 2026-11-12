/** TEST ONLY. Helpers that set up accounts and records the same way the app does. */
import { randomUUID } from "node:crypto";
import { asUser, getSql } from "@/lib/db";
import { createAgreement, issueSigningLink, saveAgreementSetup } from "@/lib/services/agreements";
import { createWorkspaceForUser } from "@/lib/services/workspace";
import { APP_URL } from "./env";
import { inkPngDataUrl, letterTwoPages } from "./pdfs";

export async function newAccount(company: string) {
  const email = `admin-${randomUUID().slice(0, 8)}@example.com`;
  const [u] = await getSql()`insert into auth.users (email) values (${email}) returning id`;
  const userId = u.id as string;
  const workspaceId = await createWorkspaceForUser(userId, company);
  return { userId, workspaceId, email };
}

export async function newClientAndCase(a: { userId: string; workspaceId: string }, reference = `REF-${randomUUID().slice(0, 6)}`) {
  return asUser(a.userId, async (tx) => {
    const [client] = await tx`insert into clients (workspace_id, name, email) values (${a.workspaceId}, 'Jordan Example', 'jordan@example.com') returning id`;
    const [c] = await tx`insert into cases (workspace_id, client_id, reference, title) values (${a.workspaceId}, ${client.id}, ${reference}, 'Test file') returning id`;
    return { clientId: client.id as string, caseId: c.id as string };
  });
}

export const STANDARD_FIELDS = [
  { page_number: 2, field_type: "signature" as const, x: 0.1, y: 0.7, width: 0.35, height: 0.07, required: true, label: null },
  { page_number: 2, field_type: "name" as const, x: 0.1, y: 0.8, width: 0.35, height: 0.035, required: true, label: null },
  { page_number: 2, field_type: "date" as const, x: 0.55, y: 0.8, width: 0.25, height: 0.035, required: true, label: null },
  { page_number: 1, field_type: "text" as const, x: 0.1, y: 0.5, width: 0.4, height: 0.035, required: false, label: "Phone" },
];

/** An agreement that has been uploaded, prepared and sent; returns the signing token too. */
export async function sentAgreement(a: { userId: string; workspaceId: string }, opts: { sendEmail?: boolean; pdf?: Uint8Array } = {}) {
  const { caseId } = await newClientAndCase(a);
  const original = opts.pdf ?? (await letterTwoPages());
  const { id } = await createAgreement({ userId: a.userId, workspaceId: a.workspaceId, caseId, title: "Unfamiliar agreement", source: { kind: "bytes", bytes: original } });
  await saveAgreementSetup({ userId: a.userId, agreementId: id, fields: STANDARD_FIELDS, signer: { name: "Jordan Example", email: "jordan@example.com" } });
  const link = await issueSigningLink({ userId: a.userId, agreementId: id, appUrl: APP_URL, sendEmail: opts.sendEmail ?? false });
  const token = link.url.split("/sign/")[1];
  const fields = await getSql()`select id, field_type from signing_fields where agreement_id = ${id}`;
  return { agreementId: id, caseId, original, link, token, fields: [...fields] as { id: string; field_type: string }[] };
}

export async function validSubmission(fields: { id: string; field_type: string }[]) {
  const image = await inkPngDataUrl();
  return {
    consent: true as const,
    timeZone: "UTC",
    values: fields
      .filter((f) => f.field_type === "signature" || f.field_type === "name")
      .map((f) => (f.field_type === "signature" ? { fieldId: f.id, image, method: "drawn" as const } : { fieldId: f.id, text: "Jordan Example" })),
  };
}

export const CLIENT = { ip: "203.0.113.7", userAgent: "vitest" };
