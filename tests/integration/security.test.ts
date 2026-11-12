import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { asUser, getSql } from "@/lib/db";
import { getAgreementDetail, getCase, getDashboard, getDocumentPath, getTemplate, listCases, listClients, listTemplates } from "@/lib/queries";
import { withinRateLimit } from "@/lib/rate-limit";
import { cancelAgreement, createAgreement, createTemplate, issueSigningLink, recallAgreement, saveAgreementSetup, saveTemplateFields } from "@/lib/services/agreements";
import { completeSigning } from "@/lib/services/signing";
import { APP_URL } from "../support/env";
import { CLIENT, STANDARD_FIELDS, newAccount, newClientAndCase, sentAgreement, validSubmission } from "../support/fixtures";
import { letterTwoPages } from "../support/pdfs";

type Account = Awaited<ReturnType<typeof newAccount>>;
let A: Account, B: Account;
let a: Awaited<ReturnType<typeof sentAgreement>> & { clientId: string; templateId: string };

beforeAll(async () => {
  A = await newAccount("Workspace A");
  B = await newAccount("Workspace B");
  const sent = await sentAgreement(A);
  const [c] = await getSql()`select client_id from cases where id = ${sent.caseId}`;
  const tpl = await createTemplate({ userId: A.userId, workspaceId: A.workspaceId, name: "A's template", source: { kind: "bytes", bytes: await letterTwoPages() } });
  await saveTemplateFields(A.userId, tpl.id, STANDARD_FIELDS);
  a = { ...sent, clientId: c.client_id, templateId: tpl.id };
  await newClientAndCase(B); // B has data of its own, so "empty" results below are not vacuous
});

const asB = <T>(fn: Parameters<typeof asUser<T>>[1]) => asUser(B.userId, fn);

describe("workspace isolation (Row Level Security)", () => {
  it("B cannot read anything belonging to A", async () => {
    await asB(async (tx) => {
      expect(await tx`select id from workspaces where id = ${A.workspaceId}`).toHaveLength(0);
      expect(await tx`select id from workspace_members where workspace_id = ${A.workspaceId}`).toHaveLength(0);
      expect(await tx`select id from clients where workspace_id = ${A.workspaceId}`).toHaveLength(0);
      expect(await tx`select id from cases where id = ${a.caseId}`).toHaveLength(0);
      expect(await tx`select id from agreements where id = ${a.agreementId}`).toHaveLength(0);
      expect(await tx`select id from agreement_signers where agreement_id = ${a.agreementId}`).toHaveLength(0);
      expect(await tx`select id from signing_fields where agreement_id = ${a.agreementId}`).toHaveLength(0);
      expect(await tx`select id from signing_requests where agreement_id = ${a.agreementId}`).toHaveLength(0);
      expect(await tx`select id from audit_events where agreement_id = ${a.agreementId}`).toHaveLength(0);
      expect(await tx`select id from templates where id = ${a.templateId}`).toHaveLength(0);
      expect(await tx`select id from template_fields where template_id = ${a.templateId}`).toHaveLength(0);
      // ...while B's own data is visible, so the policies are not simply hiding everything.
      expect((await tx`select id from clients`).length).toBeGreaterThan(0);
    });
    // A, by contrast, sees its own rows.
    await asUser(A.userId, async (tx) => {
      expect(await tx`select id from agreements where id = ${a.agreementId}`).toHaveLength(1);
      expect((await tx`select id from audit_events where agreement_id = ${a.agreementId}`).length).toBeGreaterThan(0);
    });
  });

  it("the app's read paths return nothing for another workspace's ids", async () => {
    expect(await getAgreementDetail(B.userId, a.agreementId)).toBeNull();
    expect(await getCase(B.userId, a.caseId)).toBeNull();
    expect(await getTemplate(B.userId, a.templateId)).toBeNull();
    expect(await getDocumentPath(B.userId, "original", a.agreementId)).toBeNull();
    expect(await getDocumentPath(B.userId, "completed", a.agreementId)).toBeNull();
    expect(await getDocumentPath(B.userId, "template", a.templateId)).toBeNull();
    // Even when B lies about the workspace id, RLS only returns B's rows.
    expect(await listClients(B.userId, A.workspaceId)).toHaveLength(0);
    expect(await listCases(B.userId, A.workspaceId)).toHaveLength(0);
    expect(await listTemplates(B.userId, A.workspaceId)).toHaveLength(0);
    const dash = await getDashboard(B.userId, A.workspaceId);
    expect(dash.counts.total).toBe(0);
    expect(dash.agreements).toHaveLength(0);
    expect(dash.activity).toHaveLength(0);
    expect(await getDocumentPath(A.userId, "original", a.agreementId)).not.toBeNull();
  });

  it("B cannot write into A's workspace, even by supplying A's workspace id", async () => {
    await expect(asB((tx) => tx`insert into clients (workspace_id, name, email) values (${A.workspaceId}, 'Mallory', 'm@example.com')`)).rejects.toThrow(/row-level security/);
    await expect(asB((tx) => tx`insert into cases (workspace_id, client_id, reference, title) values (${A.workspaceId}, ${a.clientId}, 'X-1', 'x')`)).rejects.toThrow(/row-level security/);
    await expect(asB((tx) => tx`insert into templates (workspace_id, name, storage_path, page_count, file_size, sha256) values (${A.workspaceId}, 't', ${`${A.workspaceId}/templates/x.pdf`}, 1, 1, 'x')`)).rejects.toThrow(/row-level security/);
    await asB(async (tx) => {
      expect((await tx`update clients set name = 'hacked' where id = ${a.clientId} returning id`)).toHaveLength(0);
      expect((await tx`update cases set title = 'hacked' where id = ${a.caseId} returning id`)).toHaveLength(0);
      expect((await tx`update agreements set title = 'hacked' where id = ${a.agreementId} returning id`)).toHaveLength(0);
      expect((await tx`delete from signing_fields where agreement_id = ${a.agreementId} returning id`)).toHaveLength(0);
      expect((await tx`update workspaces set name = 'hacked' where id = ${A.workspaceId} returning id`)).toHaveLength(0);
    });
    expect((await getSql()`select name from clients where id = ${a.clientId}`)[0].name).toBe("Jordan Example");
  });

  it("B cannot attach its own records to A's records (composite foreign keys)", async () => {
    // A case in B's workspace pointing at A's client.
    await expect(asB((tx) => tx`insert into cases (workspace_id, client_id, reference, title) values (${B.workspaceId}, ${a.clientId}, 'X-2', 'x')`)).rejects.toThrow(/foreign key/);
    // B's workspace defaulting to A's template.
    await expect(asB((tx) => tx`update workspaces set default_template_id = ${a.templateId} where id = ${B.workspaceId}`)).rejects.toThrow(/foreign key/);
    // A template row in B's workspace pointing at A's stored file.
    await expect(asB((tx) => tx`insert into templates (workspace_id, name, storage_path, page_count, file_size, sha256) values (${B.workspaceId}, 'steal', ${a.agreementId ? `${A.workspaceId}/agreements/${a.agreementId}/original.pdf` : ""}, 1, 1, 'x')`)).rejects.toThrow(/check constraint/);
  });

  it("the app's write paths refuse another workspace's ids", async () => {
    const mine = await newClientAndCase(B);
    const pdf = await letterTwoPages();
    await expect(createAgreement({ userId: B.userId, workspaceId: B.workspaceId, caseId: a.caseId, title: "x", source: { kind: "bytes", bytes: pdf } })).rejects.toThrow(/not found in your workspace/);
    await expect(createAgreement({ userId: B.userId, workspaceId: A.workspaceId, caseId: a.caseId, title: "x", source: { kind: "bytes", bytes: pdf } })).rejects.toThrow(/not found in your workspace/);
    await expect(createAgreement({ userId: B.userId, workspaceId: B.workspaceId, caseId: mine.caseId, title: "x", source: { kind: "template", templateId: a.templateId } })).rejects.toThrow(/template was not found/);
    await expect(saveAgreementSetup({ userId: B.userId, agreementId: a.agreementId, fields: [], signer: { name: "M", email: "m@example.com" } })).rejects.toThrow(/not found/);
    await expect(saveTemplateFields(B.userId, a.templateId, [])).rejects.toThrow(/not found/);
    await expect(issueSigningLink({ userId: B.userId, agreementId: a.agreementId, appUrl: APP_URL, sendEmail: false })).rejects.toThrow(/not found/);
    await expect(cancelAgreement(B.userId, a.agreementId)).rejects.toThrow(/not found/);
    await expect(recallAgreement(B.userId, a.agreementId)).rejects.toThrow(/not found/);
    expect((await getSql()`select status from agreements where id = ${a.agreementId}`)[0].status).toBe("sent");
    expect((await getSql()`select count(*)::int as n from signing_requests where agreement_id = ${a.agreementId} and status = 'pending'`)[0].n).toBe(1);
  });

  it("a user with no workspace sees nothing at all", async () => {
    const [u] = await getSql()`insert into auth.users (email) values (${`nobody-${randomUUID()}@example.com`}) returning id`;
    await asUser(u.id, async (tx) => {
      for (const table of ["workspaces", "clients", "cases", "agreements", "templates", "audit_events", "signing_fields"]) {
        expect(await tx`select 1 from ${tx(table)}`).toHaveLength(0);
      }
    });
  });
});

describe("what a signed-in member cannot do to their own workspace's records", () => {
  const asA = <T>(fn: Parameters<typeof asUser<T>>[1]) => asUser(A.userId, fn);

  it("cannot forge, edit or delete audit events", async () => {
    await expect(asA((tx) => tx`insert into audit_events (workspace_id, agreement_id, event_type, actor_type) values (${A.workspaceId}, ${a.agreementId}, 'agreement_signed', 'signer')`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`update audit_events set event_type = 'x' where agreement_id = ${a.agreementId}`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`delete from audit_events where agreement_id = ${a.agreementId}`)).rejects.toThrow(/permission denied/);
  });

  it("audit events are append-only even for trusted server code", async () => {
    await expect(getSql()`update audit_events set event_type = 'x' where agreement_id = ${a.agreementId}`).rejects.toThrow(/append-only/);
    await expect(getSql()`delete from audit_events where agreement_id = ${a.agreementId}`).rejects.toThrow(/append-only/);
  });

  it("cannot mark an agreement signed, create agreements, or mint signing links by talking to the database directly", async () => {
    await expect(asA((tx) => tx`update agreements set status = 'signed', signed_at = now(), completed_storage_path = ${`${A.workspaceId}/fake.pdf`} where id = ${a.agreementId}`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`insert into agreements (workspace_id, case_id, title, original_storage_path, original_sha256, original_size, page_count) values (${A.workspaceId}, ${a.caseId}, 't', ${`${A.workspaceId}/z.pdf`}, 'x', 1, 1)`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`insert into signing_requests (agreement_id, signer_name, signer_email, token_hash, expires_at) values (${a.agreementId}, 'x', 'x@example.com', 'known-hash', now() + interval '1 day')`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`update signing_requests set expires_at = now() + interval '10 years' where agreement_id = ${a.agreementId}`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`insert into signing_field_values (signing_request_id, signing_field_id, value_type, value) values (${randomUUID()}, ${a.fields[0].id}, 'text', 'x')`)).rejects.toThrow(/permission denied/);
  });

  it("cannot read token hashes, add themselves to another workspace, or call server-only functions", async () => {
    await expect(asA((tx) => tx`select token_hash from signing_requests where agreement_id = ${a.agreementId}`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`select * from signing_requests where agreement_id = ${a.agreementId}`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`insert into workspace_members (workspace_id, user_id, role) values (${B.workspaceId}, ${A.userId}, 'owner')`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`insert into workspaces (name) values ('free workspace')`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`select public.hit_rate_limit('x', 60, 1)`)).rejects.toThrow(/permission denied/);
    await expect(asA((tx) => tx`select * from rate_limits`)).rejects.toThrow(/permission denied/);
  });

  it("cannot change the field layout after the agreement has been sent", async () => {
    await expect(asA((tx) => tx`update signing_fields set x = 0.5 where agreement_id = ${a.agreementId}`)).rejects.toThrow(/cannot be changed while the agreement is sent/);
    await expect(asA((tx) => tx`delete from signing_fields where agreement_id = ${a.agreementId}`)).rejects.toThrow(/cannot be changed/);
    await expect(asA((tx) => tx`insert into signing_fields (agreement_id, page_number, field_type, x, y, width, height) values (${a.agreementId}, 1, 'text', 0.1, 0.1, 0.1, 0.1)`)).rejects.toThrow(/cannot be changed/);
  });
});

describe("the public (anon) database role", () => {
  it("has no access to any table", async () => {
    const sql = getSql();
    for (const table of ["workspaces", "workspace_members", "clients", "cases", "templates", "template_fields", "agreements", "agreement_signers", "signing_fields", "signing_requests", "signing_field_values", "audit_events", "rate_limits"]) {
      await expect(sql.begin(async (tx) => { await tx`set local role anon`; return tx`select 1 from ${tx(table)} limit 1`; })).rejects.toThrow(/permission denied/);
    }
  });
  it("every table has Row Level Security enabled", async () => {
    const rows = await getSql()`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});

describe("rate limiting on public signing endpoints", () => {
  it("counts hits per key and window", async () => {
    const key = `test:${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await withinRateLimit(key, 3, 60));
    expect(results).toEqual([true, true, true, false, false]);
    expect(await withinRateLimit(`test:${randomUUID()}`, 3, 60)).toBe(true);
  });

  it("stops repeated submissions against one link", async () => {
    const s = await sentAgreement(A);
    const bad = { ...(await validSubmission(s.fields)), values: [] };
    const codes: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await completeSigning(s.token, bad, { ip: `198.51.100.${i}`, userAgent: "vitest" }, APP_URL);
      codes.push(r.ok ? "ok" : r.code);
    }
    expect(codes.slice(0, 10).every((c) => c === "validation")).toBe(true);
    expect(codes.slice(10)).toEqual(["rate_limited", "rate_limited"]);
    expect(CLIENT.ip).toBeTruthy();
  });
});
