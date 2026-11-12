import { expect, test } from "@playwright/test";
import { createLink, drawSignature, newSignerPage, signUp } from "./helpers";

/** Not a test of behaviour: regenerates the README screenshots. Run with SCREENSHOTS=1. */
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate docs/screenshots");

test("capture screenshots", async ({ page, browser }) => {
  const shot = (name: string, p = page) => p.screenshot({ path: `docs/screenshots/${name}.png` });
  await signUp(page, "Astra AI");
  await shot("01-empty-dashboard");
  await page.getByTestId("load-sample").click();
  await expect(page).toHaveURL(/\/agreements\/[0-9a-f-]{36}$/);
  const agreementUrl = page.url();

  await page.goto(`${agreementUrl}/prepare`);
  await expect(page.getByTestId("pdf-pages")).toHaveAttribute("data-loaded", "true");
  await page.getByTestId("field-signature").scrollIntoViewIfNeeded();
  await page.getByTestId("field-signature").click();
  await page.waitForTimeout(800);
  await shot("02-field-editor");

  await page.goto(agreementUrl);
  const link = await createLink(page);
  await shot("03-agreement-link-created");

  const signer = await newSignerPage(browser, link);
  await expect(signer.page.getByTestId("pdf-pages")).toHaveAttribute("data-loaded", "true");
  await signer.page.waitForTimeout(800);
  await shot("04-signing-page", signer.page);
  await signer.page.getByTestId("next-field").click();
  await signer.page.getByTestId("sign-field-signature").click();
  await drawSignature(signer.page);
  await signer.page.waitForTimeout(300);
  await shot("05-signature-dialog", signer.page);
  await signer.page.getByTestId("sig-adopt").click();
  await signer.page.waitForTimeout(500);
  await shot("06-signing-filled", signer.page);

  const mobile = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  await m.goto(link);
  await expect(m.getByTestId("pdf-pages")).toHaveAttribute("data-loaded", "true");
  await m.waitForTimeout(800);
  await m.screenshot({ path: "docs/screenshots/07-signing-mobile.png" });
  await mobile.close();

  await signer.page.getByTestId("consent").check();
  await signer.page.getByTestId("finish-signing").click();
  await expect(signer.page).toHaveURL(/\/complete$/);
  await shot("08-signed-confirmation", signer.page);
  await signer.context.close();

  await page.goto(agreementUrl);
  await expect(page.getByTestId("agreement-status")).toHaveAttribute("data-status", "signed");
  await shot("09-agreement-signed");
  await page.goto("/settings");
  await page.getByLabel("Default agreement for new files").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await page.goto("/cases/new");
  await expect(page.getByLabel("Agreement to send")).toBeVisible();
  await page.getByLabel("Title").fill("Kitchen renovation claim");
  await shot("11-new-file-automation");
  await page.getByRole("button", { name: "Create file and send agreement" }).click();
  await expect(page.getByTestId("case-created")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByTestId("agreements-table")).toBeVisible();
  await page.waitForTimeout(300);
  await shot("10-dashboard");
});
