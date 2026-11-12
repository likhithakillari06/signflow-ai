import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import { TEST_DATABASE_URL } from "../support/env";

export const TMP = path.resolve(".test-tmp/e2e-files");
mkdirSync(TMP, { recursive: true });

export function saveTemp(name: string, bytes: Uint8Array | string): string {
  const file = path.join(TMP, name);
  writeFileSync(file, bytes);
  return file;
}

let n = 0;
export const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++n}`;

/** Creates a brand-new company account through the real sign-up form. */
export async function signUp(page: Page, company: string) {
  const email = `${unique("admin")}@example.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Company name").fill(company);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("workspace-name")).toHaveText(company);
  return { email, password: "correct-horse-battery" };
}

export async function createClientAndCase(page: Page, opts: { clientName?: string; reference: string; title?: string } ) {
  await page.goto("/clients/new?return=case");
  await page.getByLabel("Client name").fill(opts.clientName ?? "Jordan Example");
  await page.getByLabel("Email").fill("jordan@example.com");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/cases\/new\?client=/);
  await page.getByLabel("Reference").fill(opts.reference);
  await page.getByLabel("Title").fill(opts.title ?? "Onboarding");
}

export async function uploadAgreement(page: Page, file: string, title: string) {
  await page.getByRole("link", { name: "Add agreement" }).first().click();
  await expect(page).toHaveURL(/\/agreements\/new/);
  await page.locator("#file").setInputFiles(file);
  await page.getByLabel("Agreement title").fill(title);
  await page.getByRole("button", { name: "Upload and place fields" }).click();
}

/** Click a tool, then click the page overlay at a fraction of its size. Returns the fraction used. */
export async function placeField(page: Page, type: string, pageNumber: number, fx: number, fy: number) {
  await page.getByTestId(`tool-${type}`).click();
  const overlay = page.getByTestId(`page-overlay-${pageNumber}`);
  await overlay.scrollIntoViewIfNeeded();
  const box = (await overlay.boundingBox())!;
  await overlay.click({ position: { x: box.width * fx, y: box.height * fy } });
}

export async function drawSignature(page: Page) {
  const canvas = page.getByTestId("signature-canvas");
  await expect(canvas).toBeVisible();
  const b = (await canvas.boundingBox())!;
  const pts = [[0.15, 0.7], [0.25, 0.3], [0.35, 0.75], [0.45, 0.35], [0.55, 0.7], [0.7, 0.4], [0.85, 0.6]];
  await page.mouse.move(b.x + b.width * pts[0][0], b.y + b.height * pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + b.width * x, b.y + b.height * y, { steps: 8 });
  await page.mouse.up();
}

export async function newSignerPage(browser: Browser, url: string) {
  const context = await browser.newContext(); // separate context: no admin cookies
  const page = await context.newPage();
  await page.goto(url);
  return { context, page };
}

export async function createLink(page: Page): Promise<string> {
  await page.getByTestId("create-link").click();
  const input = page.getByTestId("signing-link");
  await expect(input).toBeVisible();
  return input.inputValue();
}

export function db() {
  return postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
}

/** Sign up, create client + file, upload `file`, put one signature field on page 1, create a link. */
export async function quickSentAgreement(page: Page, file: string, title = "Quick Agreement") {
  await signUp(page, "Astra AI");
  await createClientAndCase(page, { reference: unique("F") });
  await page.getByRole("button", { name: "Create file" }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]{36}$/);
  await uploadAgreement(page, file, title);
  await expect(page).toHaveURL(/\/prepare$/);
  const agreementId = page.url().split("/agreements/")[1].split("/")[0];
  await expect(page.getByTestId("pdf-pages")).toHaveAttribute("data-loaded", "true");
  await placeField(page, "signature", 1, 0.3, 0.8);
  await page.getByTestId("save-continue").click();
  await expect(page).toHaveURL(new RegExp(`/agreements/${agreementId}$`));
  const link = await createLink(page);
  return { agreementId, link, token: link.split("/sign/")[1] };
}
