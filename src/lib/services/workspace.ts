import "server-only";
import { asSystem, asUser } from "../db";
import { AppError } from "../errors";
import { SAMPLE_FIELDS, buildSampleAgreementPdf } from "../pdf/sample";
import { createAgreement, createTemplate, saveTemplateFields } from "./agreements";

/** First sign-in: every account gets its own isolated workspace. */
export async function createWorkspaceForUser(userId: string, name: string): Promise<string> {
  return asSystem(async (tx) => {
    const [existing] = await tx`select workspace_id from workspace_members where user_id = ${userId} limit 1`;
    if (existing) return existing.workspace_id as string;
    const [ws] = await tx`insert into workspaces (name) values (${name}) returning id`;
    await tx`insert into workspace_members (workspace_id, user_id, role) values (${ws.id}, ${userId}, 'owner')`;
    return ws.id as string;
  });
}

/**
 * Optional demo content: client "Jordan Example", file MIND-TEST-001, a clearly labelled sample
 * agreement and a matching template. Test data only; nothing else in the app depends on it.
 */
export async function loadSampleData(userId: string, workspaceId: string): Promise<{ agreementId: string }> {
  const reference = "MIND-TEST-001";
  const caseId = await asUser(userId, async (tx) => {
    const [dupe] = await tx`select id from cases where workspace_id = ${workspaceId} and reference = ${reference}`;
    if (dupe) throw new AppError("Sample data has already been loaded in this workspace.");
    const [client] = await tx`
      insert into clients (workspace_id, name, email) values (${workspaceId}, 'Jordan Example', 'jordan@example.com') returning id`;
    const [c] = await tx`
      insert into cases (workspace_id, client_id, reference, title) values (${workspaceId}, ${client.id}, ${reference}, 'Sample file (test data)') returning id`;
    return c.id as string;
  });
  const bytes = await buildSampleAgreementPdf();
  const template = await createTemplate({ userId, workspaceId, name: "Sample Client Services Agreement (demo)", source: { kind: "bytes", bytes } });
  await saveTemplateFields(userId, template.id, SAMPLE_FIELDS);
  const agreement = await createAgreement({
    userId, workspaceId, caseId, title: "Sample Client Services Agreement (demo)", source: { kind: "template", templateId: template.id },
  });
  return { agreementId: agreement.id };
}
