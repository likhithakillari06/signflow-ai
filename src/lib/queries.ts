import "server-only";
import { asUser } from "./db";
import { expireDueAgreements } from "./services/agreements";
import type { AgreementStatus } from "./status";
import type { Agreement, AuditEvent, CaseRow, Client, FieldRow, Signer, SigningRequest, Template } from "./types";

/* All reads run as the signed-in user under Row Level Security. */

export type AgreementListItem = {
  id: string; title: string; status: AgreementStatus; created_at: string; signed_at: string | null;
  case_id: string; case_reference: string; client_name: string; expires_at: string | null; sent_at: string | null;
};

const safely = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* never block a page on housekeeping */ } };

export async function getDashboard(userId: string, workspaceId: string) {
  await safely(expireDueAgreements);
  return asUser(userId, async (tx) => {
    const [counts] = await tx`
      select count(*)::int as total,
             count(*) filter (where status in ('sent', 'viewed', 'failed'))::int as awaiting,
             count(*) filter (where status = 'signed')::int as signed,
             count(*) filter (where status in ('draft', 'ready'))::int as preparing
        from agreements where workspace_id = ${workspaceId}`;
    const agreements = await tx<AgreementListItem[]>`
      select a.id, a.title, a.status, a.created_at, a.signed_at, c.id as case_id, c.reference as case_reference, cl.name as client_name,
             r.expires_at, r.created_at as sent_at
        from agreements a
        join cases c on c.id = a.case_id
        join clients cl on cl.id = c.client_id
        left join lateral (select expires_at, created_at from signing_requests r where r.agreement_id = a.id and r.status in ('pending', 'viewed') limit 1) r on true
       where a.workspace_id = ${workspaceId}
       order by a.created_at desc limit 25`;
    const activity = await tx<(AuditEvent & { title: string })[]>`
      select e.id, e.agreement_id, e.event_type, e.actor_type, e.actor_id, e.created_at, a.title
        from audit_events e join agreements a on a.id = e.agreement_id
       where e.workspace_id = ${workspaceId}
       order by e.seq desc limit 8`;
    const cases = await tx<(CaseRow & { client_name: string })[]>`
      select c.*, cl.name as client_name from cases c join clients cl on cl.id = c.client_id
       where c.workspace_id = ${workspaceId} order by c.created_at desc limit 5`;
    return { counts: counts as { total: number; awaiting: number; signed: number; preparing: number }, agreements: [...agreements], activity: [...activity], cases: [...cases] };
  });
}

export async function listClients(userId: string, workspaceId: string) {
  return asUser(userId, async (tx) => [
    ...(await tx<(Client & { case_count: number })[]>`
      select cl.*, (select count(*) from cases c where c.client_id = cl.id)::int as case_count
        from clients cl where cl.workspace_id = ${workspaceId} order by cl.created_at desc`),
  ]);
}

export type CaseListItem = CaseRow & { client_name: string; agreement_id: string | null; agreement_status: AgreementStatus | null; agreement_count: number };

export async function listCases(userId: string, workspaceId: string) {
  await safely(expireDueAgreements);
  return asUser(userId, async (tx) => [
    ...(await tx<CaseListItem[]>`
      select c.*, cl.name as client_name, la.id as agreement_id, la.status as agreement_status,
             (select count(*) from agreements a where a.case_id = c.id)::int as agreement_count
        from cases c
        join clients cl on cl.id = c.client_id
        left join lateral (select id, status from agreements a where a.case_id = c.id and a.status <> 'cancelled' order by a.created_at desc limit 1) la on true
       where c.workspace_id = ${workspaceId}
       order by c.created_at desc`),
  ]);
}

export async function getCase(userId: string, caseId: string) {
  await safely(expireDueAgreements);
  return asUser(userId, async (tx) => {
    const [c] = await tx<(CaseRow & { client_name: string; client_email: string })[]>`
      select c.*, cl.name as client_name, cl.email as client_email from cases c join clients cl on cl.id = c.client_id where c.id = ${caseId}`;
    if (!c) return null;
    const agreements = await tx<Agreement[]>`select * from agreements where case_id = ${caseId} order by created_at desc`;
    return { case: c, agreements: [...agreements] };
  });
}

export async function listTemplates(userId: string, workspaceId: string) {
  return asUser(userId, async (tx) => [
    ...(await tx<(Template & { field_count: number; signature_count: number; used_count: number })[]>`
      select t.*,
             (select count(*) from template_fields f where f.template_id = t.id)::int as field_count,
             (select count(*) from template_fields f where f.template_id = t.id and f.field_type = 'signature' and f.required)::int as signature_count,
             (select count(*) from agreements a where a.template_id = t.id)::int as used_count
        from templates t where t.workspace_id = ${workspaceId} and t.archived_at is null order by t.created_at desc`),
  ]);
}

export async function getTemplate(userId: string, templateId: string) {
  return asUser(userId, async (tx) => {
    const [t] = await tx<Template[]>`select * from templates where id = ${templateId} and archived_at is null`;
    if (!t) return null;
    const fields = await tx<FieldRow[]>`
      select id, page_number, field_type, x, y, width, height, required, label from template_fields where template_id = ${templateId} order by page_number, y, x`;
    return { template: t, fields: [...fields] };
  });
}

export async function getAgreementDetail(userId: string, agreementId: string) {
  await safely(expireDueAgreements);
  return asUser(userId, async (tx) => {
    const [a] = await tx<(Agreement & { case_reference: string; case_title: string; client_name: string; client_email: string; template_name: string | null })[]>`
      select a.*, c.reference as case_reference, c.title as case_title, cl.name as client_name, cl.email as client_email, t.name as template_name
        from agreements a
        join cases c on c.id = a.case_id
        join clients cl on cl.id = c.client_id
        left join templates t on t.id = a.template_id
       where a.id = ${agreementId}`;
    if (!a) return null;
    const [signer] = await tx<Signer[]>`select id, agreement_id, name, email from agreement_signers where agreement_id = ${agreementId}`;
    const fields = await tx<FieldRow[]>`
      select id, page_number, field_type, x, y, width, height, required, label from signing_fields where agreement_id = ${agreementId} order by page_number, y, x`;
    const requests = await tx<SigningRequest[]>`
      select id, agreement_id, signer_name, signer_email, expires_at, status, email_status, email_error, email_attempted_at,
             first_viewed_at, consent_at, signer_ip, created_at, completed_at
        from signing_requests where agreement_id = ${agreementId} order by created_at desc`;
    const audit = await tx<AuditEvent[]>`
      select id, agreement_id, signing_request_id, event_type, actor_type, actor_id, metadata, created_at
        from audit_events where agreement_id = ${agreementId} order by seq`;
    return { agreement: a, signer: signer ?? null, fields: [...fields], requests: [...requests], audit: [...audit] };
  });
}

/** Path of a document the user is allowed to read (RLS decides), or null. */
export async function getDocumentPath(userId: string, kind: "original" | "completed" | "template", id: string): Promise<{ path: string; title: string } | null> {
  return asUser(userId, async (tx) => {
    if (kind === "template") {
      const [t] = await tx`select storage_path, name from templates where id = ${id}`;
      return t ? { path: t.storage_path as string, title: t.name as string } : null;
    }
    const [a] = await tx`select original_storage_path, completed_storage_path, title from agreements where id = ${id}`;
    if (!a) return null;
    const path = kind === "original" ? a.original_storage_path : a.completed_storage_path;
    return path ? { path: path as string, title: a.title as string } : null;
  });
}
