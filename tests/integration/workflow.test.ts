import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { asUser, getSql } from "@/lib/db";
import { getAgreementDetail } from "@/lib/queries";
import { cancelAgreement, createAgreement, createTemplate, expireDueAgreements, issueSigningLink, recallAgreement, saveAgreementSetup, saveTemplateFields } from "@/lib/services/agreements";
import { completeSigning, getSignerDocumentUrl, openSigningSession } from "@/lib/services/signing";
import { loadSampleData } from "@/lib/services/workspace";
import { downloadFile, uploadFile } from "@/lib/storage";
import { hashToken, sha256Hex } from "@/lib/tokens";
import { APP_URL, EMULATOR_URL, GOOD_RESEND_KEY } from "../support/env";
import { CLIENT, STANDARD_FIELDS, newAccount, newClientAndCase, sentAgreement, validSubmission } from "../support/fixtures";
import { encryptedPdf, letterTwoPages, makePdf } from "../support/pdfs";
import { diffInk, renderPage } from "../support/render";

type Account = Awaited<ReturnType<typeof newAccount>>;
let acct: Account;
const sql = () => getSql();
const events = async (agreementId: string) => (await sql()`select event_type from audit_events where agreement_id = ${agreementId} order by seq`).map((e) => e.event_type as string);
const statusOf = async (agreementId: string) => (await sql()`select status from agreements where id = ${agreementId}`)[0].status as string;

beforeAll(async () => {
  acct = await newAccount("Astra AI");
});

describe("clients, files and agreements", () => {
  it("creates a client and a file under Row Level Security", async () => {
    const { clientId, caseId } = await newClientAndCase(acct, "MIND-TEST-INT");
    const rows = await asUser(acct.userId, (tx) => tx`select c.reference, c.status, cl.name from cases c join clients cl on cl.id = c.client_id where c.id = ${caseId}`);
    expect(rows[0]).toMatchObject({ reference: "MIND-TEST-INT", status: "intake", name: "Jordan Example" });
    expect(clientId).toBeTruthy();
  });

  it("refuses a duplicate file reference in the same workspace", async () => {
    await newClientAndCase(acct, "DUP-1");
    await expect(newClientAndCase(acct, "DUP-1")).rejects.toMatchObject({ code: "23505" });
  });

  it("uploads an unfamiliar PDF: stores it unchanged in private storage and creates a draft", async () => {
    const { caseId } = await newClientAndCase(acct);
    const pdf = await makePdf([{ width: 500, height: 700 }, { width: 842, height: 595 }, { width: 612, height: 792, rotate: 90 }], "Never seen before");
    const { id, status } = await createAgreement({ userId: acct.userId, workspaceId: acct.workspaceId, caseId, title: "Never seen", source: { kind: "bytes", bytes: pdf } });
    expect(status).toBe("draft");
    const [row] = await sql()`select * from agreements where id = ${id}`;
    expect(row).toMatchObject({ case_id: caseId, workspace_id: acct.workspaceId, page_count: 3, status: "draft", original_size: pdf.length, original_sha256: sha256Hex(pdf) });
    expect(row.original_storage_path).toBe(`${acct.workspaceId}/agreements/${id}/original.pdf`);
    const stored = await downloadFile(row.original_storage_path);
    expect(Buffer.from(stored).equals(Buffer.from(pdf))).toBe(true);
    expect(await events(id)).toEqual(["agreement_created", "original_uploaded"]);
    // Signer defaults to the file's client.
    const [signer] = await sql()`select name, email from agreement_signers where agreement_id = ${id}`;
    expect(signer).toMatchObject({ name: "Jordan Example", email: "jordan@example.com" });
  });

  it("the stored file is not publicly reachable: no key, anon key and expired links are all refused", async () => {
    const { agreementId } = await sentAgreement(acct);
    const [row] = await sql()`select original_storage_path as p from agreements where id = ${agreementId}`;
    const direct = await fetch(`${EMULATOR_URL}/storage/v1/object/agreements/${row.p}`);
    expect(direct.ok).toBe(false);
    const pub = await fetch(`${EMULATOR_URL}/storage/v1/object/public/agreements/${row.p}`);
    expect(pub.ok).toBe(false);
    const anon = await fetch(`${EMULATOR_URL}/storage/v1/object/agreements/${row.p}`, { headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } });
    expect(anon.ok).toBe(false);
    const tampered = await fetch(`${EMULATOR_URL}/storage/v1/object/sign/agreements/${row.p}?token=9999999999.forged`);
    expect(tampered.ok).toBe(false);
  });

  it("rejects invalid and encrypted uploads without creating anything", async () => {
    const { caseId } = await newClientAndCase(acct);
    const before = (await sql()`select count(*)::int as n from agreements where case_id = ${caseId}`)[0].n;
    const mk = (bytes: Uint8Array) => createAgreement({ userId: acct.userId, workspaceId: acct.workspaceId, caseId, title: "Bad", source: { kind: "bytes", bytes } });
    await expect(mk(new TextEncoder().encode("MZ this is an exe renamed to .pdf"))).rejects.toMatchObject({ problem: "not_pdf" });
    await expect(mk(encryptedPdf())).rejects.toMatchObject({ problem: "encrypted" });
    await expect(mk((await letterTwoPages()).slice(0, 200))).rejects.toMatchObject({ problem: "corrupt" });
    expect((await sql()`select count(*)::int as n from agreements where case_id = ${caseId}`)[0].n).toBe(before);
  });

  it("validates PDFs uploaded straight to storage, and only accepts paths in the caller's own upload folder", async () => {
    const { caseId } = await newClientAndCase(acct);
    const good = `${acct.workspaceId}/uploads/11111111-1111-4111-8111-111111111111.pdf`;
    await uploadFile(good, await letterTwoPages(), "application/pdf");
    const ok = await createAgreement({ userId: acct.userId, workspaceId: acct.workspaceId, caseId, title: "Direct", source: { kind: "upload", path: good } });
    expect(ok.status).toBe("draft");
    await expect(downloadFile(good)).rejects.toThrow(); // temporary upload cleaned up

    const other = await newAccount("Other Co");
    const foreign = `${other.workspaceId}/uploads/22222222-2222-4222-8222-222222222222.pdf`;
    await uploadFile(foreign, await letterTwoPages(), "application/pdf");
    await expect(createAgreement({ userId: acct.userId, workspaceId: acct.workspaceId, caseId, title: "Steal", source: { kind: "upload", path: foreign } })).rejects.toThrow(/does not belong/);
    await expect(createAgreement({ userId: acct.userId, workspaceId: acct.workspaceId, caseId, title: "Traverse", source: { kind: "upload", path: `${acct.workspaceId}/uploads/../../x.pdf` } })).rejects.toThrow(/does not belong/);
  });

  it("moves Draft -> Ready when fields are saved, and back to Draft if the signature field is removed", async () => {
    const { caseId } = await newClientAndCase(acct);
    const { id } = await createAgreement({ userId: acct.userId, workspaceId: acct.workspaceId, caseId, title: "T", source: { kind: "bytes", bytes: await letterTwoPages() } });
    const signer = { name: "Jordan Example", email: "jordan@example.com" };
    expect((await saveAgreementSetup({ userId: acct.userId, agreementId: id, fields: STANDARD_FIELDS, signer })).status).toBe("ready");
    expect(await statusOf(id)).toBe("ready");
    const noSig = await saveAgreementSetup({ userId: acct.userId, agreementId: id, fields: STANDARD_FIELDS.filter((f) => f.field_type !== "signature"), signer });
    expect(noSig).toMatchObject({ status: "draft" });
    expect(noSig.problems[0]).toMatch(/signature/);
    await expect(issueSigningLink({ userId: acct.userId, agreementId: id, appUrl: APP_URL, sendEmail: false })).rejects.toThrow(/signature field/);
    await expect(saveAgreementSetup({ userId: acct.userId, agreementId: id, fields: [{ ...STANDARD_FIELDS[0], page_number: 9 }], signer })).rejects.toThrow(/page that does not exist/);
  });
});

describe("signing requests", () => {
  it("generates a link on the deployed domain and stores only the token hash", async () => {
    const { agreementId, link, token } = await sentAgreement(acct);
    expect(link.url.startsWith(`${APP_URL}/sign/`)).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [req] = await sql()`select * from signing_requests where agreement_id = ${agreementId}`;
    expect(req.token_hash).toBe(hashToken(token));
    expect(JSON.stringify(req)).not.toContain(token);
    const everything = await sql()`select row_to_json(e)::text as j from audit_events e where agreement_id = ${agreementId}`;
    expect(everything.map((e) => e.j).join()).not.toContain(token);
    expect(req.status).toBe("pending");
    expect(new Date(req.expires_at).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect(await statusOf(agreementId)).toBe("sent");
    expect((await sql()`select c.status from cases c join agreements a on a.case_id = c.id where a.id = ${agreementId}`)[0].status).toBe("awaiting_signature");
  });

  it("records the first view once and moves Sent -> Viewed", async () => {
    const { agreementId, token } = await sentAgreement(acct);
    const s1 = await openSigningSession(token, CLIENT);
    expect(s1.state).toBe("open");
    if (s1.state !== "open") return;
    expect(s1).toMatchObject({ title: "Unfamiliar agreement", workspaceName: "Astra AI", signerName: "Jordan Example", pageCount: 2 });
    expect(s1.fields).toHaveLength(4);
    await openSigningSession(token, CLIENT);
    expect(await statusOf(agreementId)).toBe("viewed");
    expect((await events(agreementId)).filter((e) => e === "agreement_viewed")).toHaveLength(1);
  });

  it("rejects invalid tokens", async () => {
    for (const bad of ["", "nope", "A".repeat(43), "../../../etc/passwd", "x".repeat(500)]) {
      expect((await openSigningSession(bad, CLIENT)).state).toBe("invalid");
      expect(await getSignerDocumentUrl(bad, CLIENT)).toMatchObject({ status: 404 });
      expect(await completeSigning(bad, { consent: true, values: [] }, CLIENT, APP_URL)).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("enforces expiry on the server and marks the agreement Expired", async () => {
    const { agreementId, token, fields } = await sentAgreement(acct);
    await sql()`update signing_requests set expires_at = now() - interval '1 minute' where agreement_id = ${agreementId}`;
    expect((await openSigningSession(token, CLIENT)).state).toBe("expired");
    expect(await getSignerDocumentUrl(token, CLIENT)).toMatchObject({ status: 404 });
    expect(await completeSigning(token, await validSubmission(fields), CLIENT, APP_URL)).toMatchObject({ ok: false, code: "closed" });
    expect(await statusOf(agreementId)).toBe("sent"); // nothing was signed
    expect(await expireDueAgreements()).toBeGreaterThanOrEqual(1);
    expect(await statusOf(agreementId)).toBe("expired");
    expect(await events(agreementId)).toContain("agreement_expired");
    // A fresh link revives it.
    const again = await issueSigningLink({ userId: acct.userId, agreementId, appUrl: APP_URL, sendEmail: false });
    expect((await openSigningSession(again.url.split("/sign/")[1], CLIENT)).state).toBe("open");
  });

  it("rotating a link switches the old one off", async () => {
    const { agreementId, token } = await sentAgreement(acct);
    const next = await issueSigningLink({ userId: acct.userId, agreementId, appUrl: APP_URL, sendEmail: false });
    expect((await openSigningSession(token, CLIENT)).state).toBe("revoked");
    expect((await openSigningSession(next.url.split("/sign/")[1], CLIENT)).state).toBe("open");
    const reqs = await sql()`select status from signing_requests where agreement_id = ${agreementId} order by created_at`;
    expect(reqs.map((r) => r.status)).toEqual(["revoked", "viewed"]);
  });

  it("a link only ever unlocks its own agreement's document", async () => {
    const a = await sentAgreement(acct, { pdf: await makePdf([{ width: 300, height: 300 }, { width: 300, height: 300 }], "Doc A") });
    const b = await sentAgreement(acct, { pdf: await makePdf([{ width: 400, height: 400 }, { width: 400, height: 400 }], "Doc B") });
    const urlA = await getSignerDocumentUrl(a.token, CLIENT);
    if (!("url" in urlA)) throw new Error("expected url");
    const bytes = new Uint8Array(await (await fetch(urlA.url)).arrayBuffer());
    expect(sha256Hex(bytes)).toBe(sha256Hex(a.original));
    expect(sha256Hex(bytes)).not.toBe(sha256Hex(b.original));
    // Submitting B's field ids with A's token is refused.
    const cross = await completeSigning(a.token, await validSubmission(b.fields), CLIENT, APP_URL);
    expect(cross).toMatchObject({ ok: false, code: "validation" });
    expect(await statusOf(a.agreementId)).not.toBe("signed");
  });

  it("cancelled and recalled agreements cannot be signed", async () => {
    const c = await sentAgreement(acct);
    await cancelAgreement(acct.userId, c.agreementId);
    expect((await openSigningSession(c.token, CLIENT)).state).toBe("cancelled");
    expect(await completeSigning(c.token, await validSubmission(c.fields), CLIENT, APP_URL)).toMatchObject({ ok: false, code: "closed" });
    expect(await events(c.agreementId)).toContain("agreement_cancelled");
    await expect(issueSigningLink({ userId: acct.userId, agreementId: c.agreementId, appUrl: APP_URL, sendEmail: false })).rejects.toThrow(/cannot be sent/);

    const r = await sentAgreement(acct);
    await recallAgreement(acct.userId, r.agreementId);
    expect(await statusOf(r.agreementId)).toBe("ready");
    expect((await openSigningSession(r.token, CLIENT)).state).toBe("revoked");
  });
});

describe("completing a signature", () => {
  it("generates, stores and links the signed PDF, then marks the agreement Signed", async () => {
    const { agreementId, token, fields, original, caseId } = await sentAgreement(acct);
    await openSigningSession(token, CLIENT);
    const result = await completeSigning(token, await validSubmission(fields), CLIENT, APP_URL);
    expect(result).toEqual({ ok: true, alreadyCompleted: false });

    const [a] = await sql()`select * from agreements where id = ${agreementId}`;
    expect(a.status).toBe("signed");
    expect(a.signed_at).toBeTruthy();
    expect(a.completed_storage_path).toBe(`${acct.workspaceId}/agreements/${agreementId}/signed.pdf`);
    const signed = await downloadFile(a.completed_storage_path);
    expect(sha256Hex(signed)).toBe(a.completed_sha256);

    // The original is untouched; the signed copy is a valid PDF = original pages + certificate.
    expect(sha256Hex(await downloadFile(a.original_storage_path))).toBe(sha256Hex(original));
    expect((await PDFDocument.load(signed)).getPageCount()).toBe(3);

    // Signature ink is inside the configured rectangle on page 2 and nowhere else outside the fields.
    const sig = STANDARD_FIELDS[0];
    const before = await renderPage(original, 2);
    const after = await renderPage(signed, 2);
    expect(diffInk(before, after, sig).inside).toBeGreaterThan(300);
    const allFieldsBox = { x: 0.1, y: 0.7, width: 0.7, height: 0.135 };
    expect(diffInk(before, after, allFieldsBox).outside).toBe(0);
    // Page 1 had only an optional field left empty: unchanged.
    const p1 = diffInk(await renderPage(original, 1), await renderPage(signed, 1), { x: 0, y: 0, width: 1, height: 1 });
    expect(p1.inside).toBe(0);

    const [req] = await sql()`select * from signing_requests where agreement_id = ${agreementId}`;
    expect(req).toMatchObject({ status: "completed", signer_ip: CLIENT.ip });
    expect(req.consent_at).toBeTruthy();
    expect(req.consent_text).toMatch(/sign it electronically/);
    const values = await sql()`select value_type, value, method from signing_field_values where signing_request_id = ${req.id} order by value_type`;
    expect(values).toHaveLength(3); // signature image ref, name, server-set date
    expect(values[0]).toMatchObject({ value_type: "image", method: "drawn" });
    expect(values[0].value).toMatch(new RegExp(`^${acct.workspaceId}/agreements/${agreementId}/signatures/`));

    expect((await sql()`select status from cases where id = ${caseId}`)[0].status).toBe("active");
    expect(await events(agreementId)).toEqual([
      "agreement_created", "original_uploaded", "fields_configured", "signing_link_created",
      "agreement_viewed", "consent_accepted", "agreement_signed", "completed_document_generated",
    ]);

    // The signer's link now gives the signed copy (and only that).
    const session = await openSigningSession(token, CLIENT);
    expect(session.state).toBe("completed");
    const dl = await getSignerDocumentUrl(token, CLIENT, true);
    if (!("url" in dl)) throw new Error("expected url");
    const res = await fetch(dl.url);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="Unfamiliar-agreement-signed.pdf"/);
    expect(sha256Hex(new Uint8Array(await res.arrayBuffer()))).toBe(a.completed_sha256);

    // The administrator sees all of it through RLS.
    const detail = await getAgreementDetail(acct.userId, agreementId);
    expect(detail?.agreement.status).toBe("signed");
    expect(detail?.audit).toHaveLength(8);
  });

  it("is idempotent: a repeated submission does not create a second document or request", async () => {
    const { agreementId, token, fields } = await sentAgreement(acct);
    const body = await validSubmission(fields);
    expect(await completeSigning(token, body, CLIENT, APP_URL)).toEqual({ ok: true, alreadyCompleted: false });
    const [first] = await sql()`select completed_sha256, signed_at from agreements where id = ${agreementId}`;
    expect(await completeSigning(token, body, CLIENT, APP_URL)).toEqual({ ok: true, alreadyCompleted: true });
    const [second] = await sql()`select completed_sha256, signed_at from agreements where id = ${agreementId}`;
    expect(second).toEqual(first);
    expect((await events(agreementId)).filter((e) => e === "agreement_signed")).toHaveLength(1);
    expect((await sql()`select count(*)::int as n from signing_requests where agreement_id = ${agreementId} and status = 'completed'`)[0].n).toBe(1);
  });

  it("two simultaneous submissions finalise the agreement exactly once", async () => {
    const { agreementId, token, fields } = await sentAgreement(acct);
    const body = await validSubmission(fields);
    const results = await Promise.all([1, 2, 3, 4].map(() => completeSigning(token, body, CLIENT, APP_URL)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && !r.alreadyCompleted)).toHaveLength(1);
    expect((await events(agreementId)).filter((e) => e === "agreement_signed")).toHaveLength(1);
    expect((await events(agreementId)).filter((e) => e === "completed_document_generated")).toHaveLength(1);
    expect((await sql()`select count(*)::int as n from signing_field_values v join signing_requests r on r.id = v.signing_request_id where r.agreement_id = ${agreementId}`)[0].n).toBe(3);
  });

  it("refuses to finish with missing required fields or without consent, and stays unsigned", async () => {
    const { agreementId, token, fields } = await sentAgreement(acct);
    const body = await validSubmission(fields);
    const noSignature = await completeSigning(token, { ...body, values: body.values.filter((v) => !("image" in v)) }, CLIENT, APP_URL);
    expect(noSignature).toMatchObject({ ok: false, code: "validation" });
    expect(!noSignature.ok && noSignature.message).toMatch(/Signature on page 2 is required/);
    const noConsent = await completeSigning(token, { ...body, consent: false }, CLIENT, APP_URL);
    expect(noConsent).toMatchObject({ ok: false, code: "validation" });
    expect(!noConsent.ok && noConsent.message).toMatch(/agree to sign electronically/);
    const [a] = await sql()`select status, completed_storage_path from agreements where id = ${agreementId}`;
    expect(a).toMatchObject({ status: "sent", completed_storage_path: null });
    expect(await events(agreementId)).not.toContain("agreement_signed");
  });

  it("if the signed PDF cannot be produced the agreement stays unsigned, is marked Failed, and a retry can succeed", async () => {
    const { agreementId, token, fields, original } = await sentAgreement(acct);
    const [row] = await sql()`select original_storage_path as p from agreements where id = ${agreementId}`;
    // Simulate storage corruption between sending and signing.
    await uploadFile(row.p, await makePdf([{ width: 100, height: 100 }], "tampered"), "application/pdf", true);
    const failed = await completeSigning(token, await validSubmission(fields), CLIENT, APP_URL);
    expect(failed).toMatchObject({ ok: false, code: "failed" });
    let [a] = await sql()`select status, completed_storage_path, signed_at, failure_reason from agreements where id = ${agreementId}`;
    expect(a).toMatchObject({ status: "failed", completed_storage_path: null, signed_at: null });
    expect(a.failure_reason).toMatch(/no longer matches/);
    expect(await events(agreementId)).toContain("completion_failed");
    expect((await sql()`select status from signing_requests where agreement_id = ${agreementId}`)[0].status).toBe("pending");

    await uploadFile(row.p, original, "application/pdf", true);
    expect(await completeSigning(token, await validSubmission(fields), CLIENT, APP_URL)).toEqual({ ok: true, alreadyCompleted: false });
    [a] = await sql()`select status, completed_storage_path, signed_at, failure_reason from agreements where id = ${agreementId}`;
    expect(a.status).toBe("signed");
    expect(a.failure_reason).toBeNull();
  });

  it("a signed agreement is frozen: it cannot be cancelled, re-sent, re-prepared or re-signed", async () => {
    const { agreementId, token, fields } = await sentAgreement(acct);
    await completeSigning(token, await validSubmission(fields), CLIENT, APP_URL);
    await expect(cancelAgreement(acct.userId, agreementId)).rejects.toThrow(/cannot be cancelled/);
    await expect(issueSigningLink({ userId: acct.userId, agreementId, appUrl: APP_URL, sendEmail: false })).rejects.toThrow(/cannot be sent/);
    await expect(saveAgreementSetup({ userId: acct.userId, agreementId, fields: STANDARD_FIELDS, signer: { name: "X", email: "x@example.com" } })).rejects.toThrow(/already been sent/);
    await expect(sql()`update agreements set status = 'draft' where id = ${agreementId}`).rejects.toThrow(/can no longer change status/);
    await expect(sql()`update agreements set completed_storage_path = ${`${acct.workspaceId}/x.pdf`} where id = ${agreementId}`).rejects.toThrow(/cannot be modified/);
    await expect(sql()`update agreements set original_storage_path = ${`${acct.workspaceId}/y.pdf`} where id = ${agreementId}`).rejects.toThrow(/cannot be replaced/);
  });
});

describe("email invitations", () => {
  const withKey = async <T>(key: string | undefined, fn: () => Promise<T>) => {
    const prev = process.env.RESEND_API_KEY;
    if (key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = key;
    try { return await fn(); } finally { if (prev === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prev; }
  };
  const requestOf = async (id: string) => (await sql()`select email_status, email_error, email_provider_id from signing_requests where agreement_id = ${id} and status in ('pending','viewed')`)[0];

  it("without Resend configured the link still works and nothing claims an email was sent", async () => {
    const s = await withKey(undefined, () => sentAgreement(acct, { sendEmail: true }));
    expect(s.link.emailStatus).toBe("not_configured");
    expect(await requestOf(s.agreementId)).toMatchObject({ email_status: "not_configured", email_provider_id: null });
    expect(await events(s.agreementId)).toContain("invitation_email_skipped");
    expect(await events(s.agreementId)).not.toContain("invitation_email_accepted");
    expect((await openSigningSession(s.token, CLIENT)).state).toBe("open");
  });

  it("a broken email configuration is reported as a failure, never as sent, and the link still works", async () => {
    const s = await withKey("re_wrong_key", () => sentAgreement(acct, { sendEmail: true }));
    expect(s.link.emailStatus).toBe("failed");
    expect(s.link.emailError).toMatch(/API key is invalid/);
    expect(await requestOf(s.agreementId)).toMatchObject({ email_status: "failed" });
    expect(await events(s.agreementId)).toContain("invitation_email_failed");
    expect(await statusOf(s.agreementId)).toBe("sent");
    expect((await openSigningSession(s.token, CLIENT)).state).toBe("open");
  });

  it("with a working key the invitation is handed to the provider and recorded as accepted (not delivered)", async () => {
    await fetch(`${EMULATOR_URL}/resend/outbox`, { method: "DELETE" });
    const s = await withKey(GOOD_RESEND_KEY, () => sentAgreement(acct, { sendEmail: true }));
    expect(s.link.emailStatus).toBe("accepted");
    const req = await requestOf(s.agreementId);
    expect(req.email_status).toBe("accepted");
    expect(req.email_provider_id).toBeTruthy();
    const outbox = (await (await fetch(`${EMULATOR_URL}/resend/outbox`)).json()) as { to: string[]; subject: string; html: string; text: string }[];
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toEqual(["jordan@example.com"]);
    expect(outbox[0].subject).toBe("Please sign: Unfamiliar agreement");
    expect(outbox[0].html).toContain(s.link.url);
    expect(outbox[0].text).toContain(s.link.url);
  });
});

describe("templates", () => {
  it("every agreement made from a template gets its own document and never inherits a signature", async () => {
    const blank = await letterTwoPages();
    const tpl = await createTemplate({ userId: acct.userId, workspaceId: acct.workspaceId, name: "Standard agreement", source: { kind: "bytes", bytes: blank } });
    expect((await saveTemplateFields(acct.userId, tpl.id, STANDARD_FIELDS)).problems).toEqual([]);

    const first = await newClientAndCase(acct);
    const a1 = await createAgreement({ userId: acct.userId, workspaceId: acct.workspaceId, caseId: first.caseId, title: "Standard agreement", source: { kind: "template", templateId: tpl.id } });
    expect(a1.status).toBe("ready"); // fields came with the template: nothing to place
    const link = await issueSigningLink({ userId: acct.userId, agreementId: a1.id, appUrl: APP_URL, sendEmail: false });
    const f1 = [...(await sql()`select id, field_type from signing_fields where agreement_id = ${a1.id}`)] as { id: string; field_type: string }[];
    expect(f1).toHaveLength(4);
    expect(await completeSigning(link.url.split("/sign/")[1], await validSubmission(f1), CLIENT, APP_URL)).toMatchObject({ ok: true });

    // The template file is still the blank original.
    const [t] = await sql()`select storage_path, sha256 from templates where id = ${tpl.id}`;
    expect(sha256Hex(await downloadFile(t.storage_path))).toBe(sha256Hex(blank));

    // A second file created afterwards starts from the blank document, with its own rows.
    const second = await newClientAndCase(acct);
    const a2 = await createAgreement({ userId: acct.userId, workspaceId: acct.workspaceId, caseId: second.caseId, title: "Standard agreement", source: { kind: "template", templateId: tpl.id } });
    const rows = await sql()`select id, case_id, original_storage_path, original_sha256, status, completed_storage_path from agreements where id in ${sql()([a1.id, a2.id])} order by created_at`;
    expect(rows[0].original_storage_path).not.toBe(rows[1].original_storage_path);
    expect(rows[1]).toMatchObject({ case_id: second.caseId, status: "ready", completed_storage_path: null, original_sha256: sha256Hex(blank) });
    expect(sha256Hex(await downloadFile(rows[1].original_storage_path))).toBe(sha256Hex(blank));
    expect((await sql()`select count(*)::int as n from signing_field_values v join signing_fields f on f.id = v.signing_field_id where f.agreement_id = ${a2.id}`)[0].n).toBe(0);
    expect((await sql()`select count(*)::int as n from signing_requests where agreement_id = ${a2.id}`)[0].n).toBe(0);
  });

  it("loads the labelled sample data once", async () => {
    const fresh = await newAccount("Astra AI");
    const { agreementId } = await loadSampleData(fresh.userId, fresh.workspaceId);
    const detail = await getAgreementDetail(fresh.userId, agreementId);
    expect(detail?.agreement).toMatchObject({ status: "ready", case_reference: "MIND-TEST-001", client_name: "Jordan Example" });
    expect(detail?.agreement.title).toMatch(/Sample .*\(demo\)/);
    await expect(loadSampleData(fresh.userId, fresh.workspaceId)).rejects.toThrow(/already been loaded/);
  });
});
