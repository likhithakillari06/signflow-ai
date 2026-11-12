import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { FIELD_DEFAULT_SIZE } from "../../src/lib/fields";
import { makePdf } from "../support/pdfs";
import { diffInk, renderPage } from "../support/render";
import { createClientAndCase, createLink, drawSignature, newSignerPage, placeField, saveTemp, signUp, unique, uploadAgreement } from "./helpers";

test("full journey: unfamiliar PDF uploaded, signature placed on page two, signed by the client, signed PDF verified", async ({ page, browser }) => {
  // A PDF this application has never seen: three pages, three different sizes, page two landscape.
  const pages = [{ width: 612, height: 792 }, { width: 792, height: 612 }, { width: 595, height: 842 }];
  const original = await makePdf(pages, "Unseen engagement letter");
  const file = saveTemp(`${unique("unseen")}.pdf`, original);

  // 1. Log in as administrator (new company account)
  await signUp(page, "Astra AI");

  // 2-3. Create a client and a file
  await createClientAndCase(page, { reference: unique("MIND"), title: "New engagement" });
  await page.getByRole("button", { name: "Create file" }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);

  // 4. Upload the new PDF
  await uploadAgreement(page, file, "Engagement Letter");
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]{36}\/prepare$/);
  const agreementId = page.url().split("/agreements/")[1].split("/")[0];
  await expect(page.getByTestId("pdf-pages")).toHaveAttribute("data-loaded", "true");
  await expect(page.getByTestId("pdf-page-2")).toHaveAttribute("data-page-width", "792");

  // 5. Place a signature field on page two, plus a required text field and a date
  const SIG = { fx: 0.3, fy: 0.62 };
  await placeField(page, "signature", 2, SIG.fx, SIG.fy);
  await placeField(page, "text", 2, 0.7, 0.3);
  await page.getByLabel("Label shown to the signer").fill("Company number");
  await placeField(page, "date", 2, 0.7, 0.62);
  await expect(page.getByTestId("field-count")).toHaveText("3 fields");

  // 6. Save the agreement
  await page.getByTestId("save-continue").click();
  await expect(page).toHaveURL(new RegExp(`/agreements/${agreementId}$`));
  await expect(page.getByTestId("agreement-status")).toHaveAttribute("data-status", "ready");

  // 7. Generate the signing link
  const link = await createLink(page);
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sign\/[A-Za-z0-9_-]{43}$/);
  await page.reload();
  await expect(page.getByTestId("agreement-status")).toHaveAttribute("data-status", "sent");

  // 8. Open the link in a separate browser context (no account, no cookies)
  const signer = await newSignerPage(browser, link);
  await expect(signer.page.getByTestId("sign-title")).toHaveText("Engagement Letter");
  await expect(signer.page.getByTestId("sign-company")).toHaveText("Astra AI");
  await expect(signer.page.getByTestId("pdf-pages")).toHaveAttribute("data-loaded", "true");

  // Cannot finish with required fields empty, or without consent
  await signer.page.getByTestId("finish-signing").click();
  await expect(signer.page.getByTestId("sign-error")).toContainText("2 required fields are still empty");

  // 9. Draw a signature (clear and retry once)
  await signer.page.getByTestId("sign-field-signature").click();
  await signer.page.getByTestId("sig-adopt").click();
  await expect(signer.page.getByText("Please draw your signature in the box first.")).toBeVisible();
  await drawSignature(signer.page);
  await signer.page.getByTestId("sig-clear").click();
  await drawSignature(signer.page);
  await signer.page.getByTestId("sig-adopt").click();
  await expect(signer.page.getByTestId("sign-field-signature")).toHaveAttribute("data-done", "true");

  // 10. Complete the required text field
  await signer.page.getByTestId("sign-field-text").click();
  await signer.page.getByTestId("text-input").fill("SC-123456");
  await signer.page.getByTestId("text-save").click();
  await signer.page.getByTestId("finish-signing").click();
  await expect(signer.page.getByTestId("sign-error")).toContainText("tick the box");

  // 11-12. Accept consent and submit
  await signer.page.getByTestId("consent").check();
  await signer.page.getByTestId("finish-signing").click();
  await expect(signer.page).toHaveURL(/\/sign\/[A-Za-z0-9_-]{43}\/complete$/);
  await expect(signer.page.getByTestId("completion-status")).toContainText("Engagement Letter");

  // The signer can download their copy through the same scoped link
  const [signerDownload] = await Promise.all([signer.page.waitForEvent("download"), signer.page.getByTestId("signer-download").click()]);
  expect(signerDownload.suggestedFilename()).toBe("Engagement-Letter-signed.pdf");
  // Re-opening the signing link now shows the completion page, not the form
  await signer.page.goto(link);
  await expect(signer.page).toHaveURL(/\/complete$/);
  await signer.context.close();

  // 13-14. Back on the administrator dashboard the agreement is Signed
  await page.goto("/dashboard");
  const row = page.locator(`[data-agreement-id="${agreementId}"]`);
  await expect(row.getByTestId("agreement-status")).toHaveAttribute("data-status", "signed");
  await expect(page.getByTestId("stat-completed")).toHaveText("1");
  await row.getByRole("link", { name: "Engagement Letter" }).click();
  for (const event of ["agreement_created", "original_uploaded", "fields_configured", "signing_link_created", "agreement_viewed", "consent_accepted", "agreement_signed", "completed_document_generated"]) {
    await expect(page.locator(`[data-testid="audit-trail"] [data-event="${event}"]`)).toHaveCount(1);
  }

  // 15. Download the completed PDF
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-signed").click()]);
  const signed = new Uint8Array(readFileSync(await download.path()));

  // 16. Programmatic verification: valid PDF, original pages intact, signature exactly where it was placed
  const doc = await PDFDocument.load(signed);
  expect(doc.getPageCount()).toBe(4); // 3 original pages + certificate
  expect(doc.getPage(1).getSize()).toEqual({ width: 792, height: 612 });

  const sigRect = {
    x: SIG.fx - FIELD_DEFAULT_SIZE.signature.width / 792 / 2, y: SIG.fy - FIELD_DEFAULT_SIZE.signature.height / 612 / 2,
    width: FIELD_DEFAULT_SIZE.signature.width / 792, height: FIELD_DEFAULT_SIZE.signature.height / 612,
  };
  const before = await renderPage(original, 2);
  const after = await renderPage(signed, 2);
  const sigDiff = diffInk(before, after, sigRect, 0.006);
  expect(sigDiff.inside, "signature ink inside the field placed on page two").toBeGreaterThan(300);

  const rectFor = (type: "text" | "date", fx: number, fy: number) => ({
    x: fx - FIELD_DEFAULT_SIZE[type].width / 792 / 2, y: fy - FIELD_DEFAULT_SIZE[type].height / 612 / 2,
    width: FIELD_DEFAULT_SIZE[type].width / 792, height: FIELD_DEFAULT_SIZE[type].height / 612,
  });
  expect(diffInk(before, after, rectFor("text", 0.7, 0.3), 0.006).inside).toBeGreaterThan(30);
  expect(diffInk(before, after, rectFor("date", 0.7, 0.62), 0.006).inside).toBeGreaterThan(30);
  // Nothing changed on page two outside the three fields...
  const changedOutsideAll = diffInk(before, after, { x: 0, y: 0, width: 0, height: 0 }, 0).outside
    - sigDiff.inside - diffInk(before, after, rectFor("text", 0.7, 0.3), 0.006).inside - diffInk(before, after, rectFor("date", 0.7, 0.62), 0.006).inside;
  expect(changedOutsideAll).toBe(0);
  // ...and pages one and three are pixel-identical to the upload.
  for (const n of [1, 3]) {
    const d = diffInk(await renderPage(original, n), await renderPage(signed, n), { x: 0, y: 0, width: 1, height: 1 }, 0);
    expect(d.inside).toBe(0);
  }
  // The typed value is real, selectable text in the PDF.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const js = await pdfjs.getDocument({ data: new Uint8Array(signed), verbosity: 0 }).promise;
  const text = (await (await js.getPage(2)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
  expect(text).toContain("SC-123456");
  expect(text).toContain("Unseen engagement letter");
  await js.destroy();
});
