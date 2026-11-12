import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { encryptedPdf, inkPngDataUrl, letterTwoPages, makePdf } from "../support/pdfs";
import { createClientAndCase, createLink, db, drawSignature, newSignerPage, placeField, quickSentAgreement, saveTemp, signUp, unique, uploadAgreement } from "./helpers";

test.describe("uploads", () => {
  test("invalid, corrupted and encrypted PDFs are refused with a clear message", async ({ page }) => {
    await signUp(page, "Astra AI");
    await createClientAndCase(page, { reference: unique("F") });
    await page.getByRole("button", { name: "Create file" }).click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    const caseUrl = page.url();

    await uploadAgreement(page, saveTemp("not-really.pdf", "This is a text file that was renamed to .pdf"), "Fake");
    await expect(page.locator("form [role=alert]")).toContainText("This file is not a PDF");
    await expect(page).toHaveURL(/\/agreements\/new/);

    await page.locator("#file").setInputFiles(saveTemp("encrypted.pdf", encryptedPdf()));
    await page.getByRole("button", { name: "Upload and place fields" }).click();
    await expect(page.locator("form [role=alert]")).toContainText("password-protected or encrypted");

    await page.locator("#file").setInputFiles(saveTemp("truncated.pdf", (await letterTwoPages()).slice(0, 300)));
    await page.getByRole("button", { name: "Upload and place fields" }).click();
    await expect(page.locator("form [role=alert]")).toContainText("could not be read");

    // Nothing was created on the file.
    await page.goto(caseUrl);
    await expect(page.getByText("No agreement yet")).toBeVisible();
  });

  test("a PDF larger than the server request limit uploads straight to private storage and is still validated", async ({ page }) => {
    const doc = await PDFDocument.load(await letterTwoPages());
    const padding = new Uint8Array(randomBytes(5 * 1024 * 1024)); // incompressible
    await doc.attach(padding, "appendix.bin", { mimeType: "application/octet-stream" });
    const big = await doc.save({ useObjectStreams: false });
    expect(big.length).toBeGreaterThan(4 * 1024 * 1024);

    await signUp(page, "Astra AI");
    await createClientAndCase(page, { reference: unique("F") });
    await page.getByRole("button", { name: "Create file" }).click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    await uploadAgreement(page, saveTemp("large.pdf", big), "Large Agreement");
    await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]{36}\/prepare$/, { timeout: 60_000 });
    await expect(page.getByTestId("pdf-pages")).toHaveAttribute("data-loaded", "true", { timeout: 60_000 });
    await expect(page.getByTestId("pdf-page-2")).toBeVisible();
  });
});

test.describe("signing links", () => {
  test("an invalid link shows a helpful page and reveals nothing", async ({ page }) => {
    await page.goto(`/sign/${"A".repeat(43)}`);
    await expect(page.getByTestId("sign-message")).toContainText("This link is not valid");
    await page.goto("/sign/short");
    await expect(page.getByTestId("sign-message")).toContainText("This link is not valid");
    const res = await page.request.post("/api/signing/document", { data: { token: "A".repeat(43) } });
    expect(res.status()).toBe(404);
  });

  test("an expired link cannot be used, and the administrator sees Expired", async ({ page, browser }) => {
    const { agreementId, link, token } = await quickSentAgreement(page, saveTemp(`${unique("exp")}.pdf`, await letterTwoPages()));
    const sql = db();
    await sql`update signing_requests set expires_at = now() - interval '1 hour' where agreement_id = ${agreementId}`;
    await sql.end();

    const signer = await newSignerPage(browser, link);
    await expect(signer.page.getByTestId("sign-message")).toContainText("This link has expired");
    const submit = await signer.page.request.post("/api/signing/complete", { data: { token, consent: true, values: [] } });
    expect(submit.status()).toBe(409);
    await signer.context.close();

    await page.reload();
    await expect(page.getByTestId("agreement-status")).toHaveAttribute("data-status", "expired");
    await expect(page.locator('[data-event="agreement_expired"]')).toHaveCount(1);
    // A new link brings it back.
    const fresh = await createLink(page);
    const again = await newSignerPage(browser, fresh);
    await expect(again.page.getByTestId("sign-title")).toBeVisible();
    await again.context.close();
  });

  test("a cancelled agreement cannot be signed", async ({ page, browser }) => {
    const { link } = await quickSentAgreement(page, saveTemp(`${unique("can")}.pdf`, await letterTwoPages()));
    await page.getByTestId("cancel-agreement").click();
    await page.getByTestId("confirm-action").click();
    await expect(page.getByTestId("agreement-status")).toHaveAttribute("data-status", "cancelled");
    const signer = await newSignerPage(browser, link);
    await expect(signer.page.getByTestId("sign-message")).toContainText("This agreement was cancelled");
    await signer.context.close();
  });

  test("submitting twice does not sign twice; missing fields are refused by the server, not just the browser", async ({ page, browser }) => {
    const { agreementId, link, token } = await quickSentAgreement(page, saveTemp(`${unique("dup")}.pdf`, await letterTwoPages()));
    const signer = await newSignerPage(browser, link);
    await expect(signer.page.getByTestId("pdf-pages")).toHaveAttribute("data-loaded", "true");

    // Straight to the API with nothing filled in: refused, still unsigned.
    const empty = await signer.page.request.post("/api/signing/complete", { data: { token, consent: true, values: [] } });
    expect(empty.status()).toBe(422);
    expect((await empty.json()).message).toContain("Signature on page 1 is required");
    const noConsent = await signer.page.request.post("/api/signing/complete", { data: { token, consent: false, values: [] } });
    expect(noConsent.status()).toBe(422);

    const sql = db();
    const [field] = await sql`select id from signing_fields where agreement_id = ${agreementId}`;
    const body = { token, consent: true, values: [{ fieldId: field.id, image: await inkPngDataUrl(), method: "drawn" }] };
    const [r1, r2] = await Promise.all([signer.page.request.post("/api/signing/complete", { data: body }), signer.page.request.post("/api/signing/complete", { data: body })]);
    const results = [await r1.json(), await r2.json()];
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => !r.alreadyCompleted)).toHaveLength(1);
    const third = await signer.page.request.post("/api/signing/complete", { data: body });
    expect(await third.json()).toEqual({ ok: true, alreadyCompleted: true });

    expect((await sql`select count(*)::int as n from audit_events where agreement_id = ${agreementId} and event_type = 'agreement_signed'`)[0].n).toBe(1);
    expect((await sql`select count(*)::int as n from signing_requests where agreement_id = ${agreementId} and status = 'completed'`)[0].n).toBe(1);
    await sql.end();
    await signer.context.close();
  });
});

test.describe("access control", () => {
  test("another company cannot open, download or act on this company's agreement; signed-out visitors are sent to login", async ({ page, browser }) => {
    const { agreementId } = await quickSentAgreement(page, saveTemp(`${unique("acl")}.pdf`, await letterTwoPages()));
    const caseHref = await page.getByRole("link", { name: /^File / }).getAttribute("href");

    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await signUp(other, "Rival Co");
    for (const url of [`/agreements/${agreementId}`, `/agreements/${agreementId}/prepare`, caseHref!]) {
      await other.goto(url);
      await expect(other.getByRole("heading", { name: "Page not found" }), url).toBeVisible();
      await expect(other.getByText("Quick Agreement")).toHaveCount(0);
    }
    expect((await other.request.get(`/api/agreements/${agreementId}/document?kind=original`)).status()).toBe(404);
    expect((await other.request.get(`/api/agreements/${agreementId}/document?kind=original&download=1`, { maxRedirects: 0 })).status()).toBe(404);
    await other.goto("/dashboard");
    await expect(other.getByText("No agreements yet")).toBeVisible();
    await otherContext.close();

    const anonContext = await browser.newContext();
    const anon = await anonContext.newPage();
    await anon.goto(`/agreements/${agreementId}`);
    await expect(anon).toHaveURL(/\/login$/);
    await anon.goto("/dashboard");
    await expect(anon).toHaveURL(/\/login$/);
    expect((await anon.request.get(`/api/agreements/${agreementId}/document?kind=original`, { maxRedirects: 0 })).status()).not.toBe(200);
    await anonContext.close();

    // The owner still can.
    const mine = await page.request.get(`/api/agreements/${agreementId}/document?kind=original`);
    expect(mine.status()).toBe(200);
    expect((await mine.json()).url).toContain("/storage/v1/object/sign/agreements/");
  });
});

test.describe("templates and automation", () => {
  test("save the standard agreement once; a new file then sends it in one step (typed signature, broken email reported honestly)", async ({ page, browser }) => {
    await signUp(page, "Astra AI");

    // Template: upload once, place fields once.
    await page.goto("/templates/new");
    await page.locator("#file").setInputFiles(saveTemp(`${unique("tpl")}.pdf`, await makePdf([{ width: 612, height: 792 }, { width: 612, height: 792, rotate: 90 }], "Standard terms")));
    await page.getByLabel("Template name").fill("Standard Client Agreement");
    await page.getByRole("button", { name: "Upload and place fields" }).click();
    await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("pdf-pages")).toHaveAttribute("data-loaded", "true");
    await placeField(page, "signature", 2, 0.3, 0.7); // on the rotated page
    await placeField(page, "name", 2, 0.3, 0.85);
    await placeField(page, "initials", 1, 0.85, 0.92);
    await page.getByTestId("save-continue").click();
    await expect(page).toHaveURL(/\/templates$/);
    await expect(page.getByRole("link", { name: "Standard Client Agreement" })).toBeVisible();

    // Make it the default for new files.
    await page.goto("/settings");
    await page.getByLabel("Default agreement for new files").selectOption({ label: "Standard Client Agreement" });
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
    await expect(page.getByTestId("system-status")).toContainText("schema is installed");
    await expect(page.getByTestId("system-status")).toContainText('Bucket "agreements" exists and is private');

    // New file: template is pre-selected and "send straight away" is ticked.
    await createClientAndCase(page, { reference: unique("AUTO"), clientName: "Jordan Example" });
    await expect(page.getByLabel("Agreement to send")).toHaveValue(/[0-9a-f-]{36}/);
    await expect(page.getByLabel(/Send for signature straight away/)).toBeChecked();
    await page.getByRole("button", { name: "Create file and send agreement" }).click();

    // One step later there is a live link. The email could not go out (bad key) and the UI says so.
    await expect(page.getByTestId("case-created")).toBeVisible();
    await expect(page.getByTestId("email-status")).toHaveAttribute("data-status", "failed");
    await expect(page.getByTestId("email-status")).toContainText("was NOT sent");
    const link = await page.getByTestId("signing-link").inputValue();
    await page.getByRole("button", { name: "Open agreement" }).click();
    await expect(page.getByTestId("agreement-status")).toHaveAttribute("data-status", "sent");
    await expect(page.getByTestId("delivery-status")).toHaveAttribute("data-status", "failed");
    await expect(page.locator('[data-event="invitation_email_failed"]')).toHaveCount(1);

    // Client signs with a typed signature; name is pre-filled; initials are drawn.
    const signer = await newSignerPage(browser, link);
    await expect(signer.page.getByTestId("pdf-pages")).toHaveAttribute("data-loaded", "true");
    await signer.page.getByTestId("next-field").click();
    await signer.page.getByTestId("sign-field-initials").click();
    await drawSignature(signer.page);
    await signer.page.getByTestId("sig-adopt").click();
    await signer.page.getByTestId("sign-field-signature").click();
    await signer.page.getByTestId("sig-tab-type").click();
    await expect(signer.page.getByTestId("sig-typed-input")).toHaveValue("Jordan Example");
    await signer.page.getByTestId("sig-adopt").click();
    await expect(signer.page.getByTestId("sign-field-signature")).toHaveAttribute("data-done", "true");
    await expect(signer.page.getByTestId("sign-field-name")).toHaveAttribute("data-done", "true");
    await signer.page.getByTestId("consent").check();
    await signer.page.getByTestId("finish-signing").click();
    await expect(signer.page).toHaveURL(/\/complete$/);
    await signer.context.close();

    await page.reload();
    await expect(page.getByTestId("agreement-status")).toHaveAttribute("data-status", "signed");
    // The file is cleared to start.
    await page.getByRole("link", { name: /^File / }).click();
    await expect(page.getByText("Cleared to start")).toBeVisible();

    // The template is unchanged and reusable: a second file gets a fresh, unsigned copy.
    await createClientAndCase(page, { reference: unique("AUTO"), clientName: "Second Client" });
    await page.getByLabel(/Send for signature straight away/).uncheck();
    await page.getByRole("button", { name: "Create file" }).click();
    await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("agreement-status")).toHaveAttribute("data-status", "ready");
  });

  test("sample data loads a clearly labelled demo agreement that can be sent immediately", async ({ page, browser }) => {
    await signUp(page, "Astra AI");
    await page.getByTestId("load-sample").click();
    await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("(demo)");
    await expect(page.getByTestId("agreement-status")).toHaveAttribute("data-status", "ready");
    await expect(page.getByRole("link", { name: /MIND-TEST-001/ }).first()).toBeVisible();
    const link = await createLink(page);
    const signer = await newSignerPage(browser, link);
    await expect(signer.page.getByTestId("sign-title")).toContainText("(demo)");
    await signer.context.close();
  });
});
