import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { decodePngDataUrl, type CleanValue, type FieldDef } from "@/lib/fields";
import { FinalizeError, buildSignedPdf } from "@/lib/pdf/finalize";
import { PdfValidationError, inspectPdf } from "@/lib/pdf/inspect";
import { buildSampleAgreementPdf, SAMPLE_FIELDS } from "@/lib/pdf/sample";
import { encryptedPdf, inkPngDataUrl, makePdf, type PageSpec } from "../support/pdfs";
import { diffInk, renderPage } from "../support/render";

const FID = "00000000-0000-4000-8000-000000000001";

async function signAt(original: Uint8Array, page: number, rect: { x: number; y: number; width: number; height: number }) {
  const field: FieldDef = { id: FID, page_number: page, field_type: "signature", ...rect, required: true, label: null };
  // Ink PNG with the same aspect ratio as the field would leave no slack; use a wide one on purpose.
  const png = decodePngDataUrl(await inkPngDataUrl(400, 100))!;
  const values: CleanValue[] = [{ fieldId: FID, kind: "image", png, method: "drawn" }];
  return buildSignedPdf({ original, fields: [field], values });
}

/**
 * The real acceptance check for placement: render the page before and after signing the way
 * a PDF viewer does, and require that (a) ink appeared inside the rectangle the administrator
 * drew and (b) nothing changed anywhere else on the page.
 */
async function expectInkExactlyIn(original: Uint8Array, signed: Uint8Array, page: number, rect: { x: number; y: number; width: number; height: number }) {
  const before = await renderPage(original, page);
  const after = await renderPage(signed, page);
  const diff = diffInk(before, after, rect);
  expect(diff.inside, "signature ink inside the configured field").toBeGreaterThan(400);
  expect(diff.outside, "pixels changed outside the configured field").toBe(0);
  // The ink should span most of the box width (image is wider than the box is tall).
  expect(diff.bounds!.x).toBeGreaterThanOrEqual(rect.x - 0.012);
  expect(diff.bounds!.x + diff.bounds!.width).toBeLessThanOrEqual(rect.x + rect.width + 0.012);
  expect(diff.bounds!.y).toBeGreaterThanOrEqual(rect.y - 0.012);
  expect(diff.bounds!.y + diff.bounds!.height).toBeLessThanOrEqual(rect.y + rect.height + 0.012);
}

const CASES: { name: string; pages: PageSpec[]; page: number; rect: { x: number; y: number; width: number; height: number } }[] = [
  { name: "US Letter portrait, bottom-left", pages: [{ width: 612, height: 792 }], page: 1, rect: { x: 0.1, y: 0.8, width: 0.35, height: 0.07 } },
  { name: "A4 portrait, top-right", pages: [{ width: 595, height: 842 }], page: 1, rect: { x: 0.6, y: 0.05, width: 0.3, height: 0.06 } },
  { name: "landscape page (wider than tall)", pages: [{ width: 792, height: 612 }], page: 1, rect: { x: 0.55, y: 0.7, width: 0.3, height: 0.1 } },
  { name: "portrait sheet rotated 90° (displays landscape)", pages: [{ width: 612, height: 792, rotate: 90 }], page: 1, rect: { x: 0.15, y: 0.6, width: 0.3, height: 0.1 } },
  { name: "page rotated 180°", pages: [{ width: 612, height: 792, rotate: 180 }], page: 1, rect: { x: 0.5, y: 0.2, width: 0.35, height: 0.07 } },
  { name: "page rotated 270°", pages: [{ width: 612, height: 792, rotate: 270 }], page: 1, rect: { x: 0.6, y: 0.15, width: 0.25, height: 0.12 } },
  { name: "cropped page with shifted origin", pages: [{ width: 612, height: 792, cropBox: [50, 80, 400, 500] }], page: 1, rect: { x: 0.2, y: 0.5, width: 0.4, height: 0.08 } },
  { name: "cropped and rotated 90°", pages: [{ width: 612, height: 792, cropBox: [30, 40, 500, 600], rotate: 90 }], page: 1, rect: { x: 0.3, y: 0.3, width: 0.3, height: 0.1 } },
  { name: "mixed sizes, field on page 3 of 4", pages: [{ width: 612, height: 792 }, { width: 842, height: 595 }, { width: 420, height: 595 }, { width: 612, height: 1008 }], page: 3, rect: { x: 0.25, y: 0.75, width: 0.5, height: 0.08 } },
  { name: "tiny page (A6)", pages: [{ width: 298, height: 420 }], page: 1, rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 } },
];

describe("signed PDF: signature lands exactly where the field was placed", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const original = await makePdf(c.pages);
      const signed = await signAt(original, c.page, c.rect);
      await expectInkExactlyIn(original, signed, c.page, c.rect);
      // Other pages are pixel-identical.
      for (let n = 1; n <= c.pages.length; n++) {
        if (n === c.page) continue;
        const d = diffInk(await renderPage(original, n), await renderPage(signed, n), { x: 0, y: 0, width: 0, height: 0 }, 0);
        expect(d.inside + d.outside).toBe(0);
      }
    });
  }
});

describe("signed PDF: content and structure", () => {
  it("draws name, date and text values inside their fields and keeps the original text", async () => {
    const original = await makePdf([{ width: 612, height: 792 }, { width: 612, height: 792 }]);
    const mk = (n: number, type: FieldDef["field_type"], y: number): FieldDef => ({ id: `00000000-0000-4000-8000-00000000000${n}`, page_number: 2, field_type: type, x: 0.1, y, width: 0.4, height: 0.035, required: true, label: null });
    const fields = [mk(1, "name", 0.5), mk(2, "date", 0.6), mk(3, "text", 0.7)];
    const signed = await buildSignedPdf({
      original, fields,
      values: [
        { fieldId: fields[0].id, kind: "text", text: "Jordan Example" },
        { fieldId: fields[1].id, kind: "text", text: "Nov 10, 2026" },
        { fieldId: fields[2].id, kind: "text", text: "12 Sample Street" },
      ],
    });
    const before = await renderPage(original, 2);
    const after = await renderPage(signed, 2);
    for (const f of fields) expect(diffInk(before, after, f).inside).toBeGreaterThan(50);
    const union = { x: 0.1, y: 0.5, width: 0.4, height: 0.235 };
    expect(diffInk(before, after, union).outside).toBe(0);

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(signed), verbosity: 0 }).promise;
    const text = (await (await doc.getPage(2)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ");
    expect(text).toContain("Jordan Example");
    expect(text).toContain("Nov 10, 2026");
    expect(text).toContain("12 Sample Street");
    expect(text).toContain("The parties agree to the terms"); // original content intact and still selectable
    await doc.destroy();
  });

  it("prints non-Latin-1 names with the bundled Unicode font", async () => {
    const original = await makePdf([{ width: 612, height: 792 }]);
    const f: FieldDef = { id: FID, page_number: 1, field_type: "name", x: 0.1, y: 0.5, width: 0.5, height: 0.04, required: true, label: null };
    const signed = await buildSignedPdf({ original, fields: [f], values: [{ fieldId: FID, kind: "text", text: "Zoë Łukasz Ωmega Жук" }] });
    expect(diffInk(await renderPage(original, 1), await renderPage(signed, 1), f).inside).toBeGreaterThan(50);
  });

  it("returns a clear, fixable error for characters no bundled font can print", async () => {
    const original = await makePdf([{ width: 612, height: 792 }]);
    const f: FieldDef = { id: FID, page_number: 1, field_type: "name", x: 0.1, y: 0.5, width: 0.5, height: 0.04, required: true, label: null };
    await expect(buildSignedPdf({ original, fields: [f], values: [{ fieldId: FID, kind: "text", text: "山田太郎" }] })).rejects.toThrow(FinalizeError);
  });

  it("appends a certificate page without touching the agreement pages", async () => {
    const original = await makePdf([{ width: 612, height: 792 }]);
    const f: FieldDef = { id: FID, page_number: 1, field_type: "signature", x: 0.1, y: 0.8, width: 0.3, height: 0.06, required: true, label: null };
    const signed = await buildSignedPdf({
      original, fields: [f], values: [{ fieldId: FID, kind: "image", png: decodePngDataUrl(await inkPngDataUrl())!, method: "drawn" }],
      certificate: {
        agreementTitle: "Test", workspaceName: "Astra AI", agreementId: "id", originalSha256: "ab".repeat(32), signerName: "Jordan Example", signerEmail: "jordan@example.com",
        signedAtIso: "2026-11-10 12:00:00 UTC", ip: "203.0.113.5", userAgent: "vitest", consentText: "I agree to sign electronically.", events: [{ at: "2026-11-10 11:00:00 UTC", label: "Agreement created" }],
      },
    });
    const doc = await PDFDocument.load(signed);
    expect(doc.getPageCount()).toBe(2);
    await expectInkExactlyIn(original, signed, 1, f);
  });

  it("leaves optional empty fields blank and fails on a field pointing at a missing page", async () => {
    const original = await makePdf([{ width: 612, height: 792 }]);
    const optional: FieldDef = { id: FID, page_number: 1, field_type: "text", x: 0.1, y: 0.5, width: 0.3, height: 0.04, required: false, label: null };
    const untouched = await buildSignedPdf({ original, fields: [optional], values: [] });
    const d = diffInk(await renderPage(original, 1), await renderPage(untouched, 1), optional);
    expect(d.inside + d.outside).toBe(0);
    await expect(buildSignedPdf({ original, fields: [{ ...optional, page_number: 5 }], values: [{ fieldId: FID, kind: "text", text: "x" }] })).rejects.toThrow(FinalizeError);
  });

  it("the sample agreement's built-in field layout sits on its signature lines", async () => {
    const original = await buildSampleAgreementPdf();
    const sig = SAMPLE_FIELDS[0];
    const signed = await signAt(original, sig.page_number, sig);
    await expectInkExactlyIn(original, signed, sig.page_number, sig);
  });
});

describe("PDF validation on upload", () => {
  it("accepts unfamiliar valid PDFs and reports their page geometry", async () => {
    const info = await inspectPdf(await makePdf([{ width: 612, height: 792 }, { width: 842, height: 595, rotate: 90 }]));
    expect(info.pageCount).toBe(2);
    expect(info.pages[1]).toMatchObject({ width: 842, height: 595, rotation: 90 });
  });
  it("rejects files that are not PDFs, whatever they are called", async () => {
    await expect(inspectPdf(new TextEncoder().encode("<html>not a pdf</html>"))).rejects.toMatchObject({ problem: "not_pdf" });
    await expect(inspectPdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))).rejects.toMatchObject({ problem: "not_pdf" });
    await expect(inspectPdf(new Uint8Array())).rejects.toMatchObject({ problem: "empty" });
  });
  it("rejects corrupted PDFs", async () => {
    const good = await makePdf([{ width: 612, height: 792 }]);
    const truncated = good.slice(0, 120);
    await expect(inspectPdf(truncated)).rejects.toBeInstanceOf(PdfValidationError);
    await expect(inspectPdf(new TextEncoder().encode("%PDF-1.7\nthis is garbage, not objects\n%%EOF"))).rejects.toBeInstanceOf(PdfValidationError);
  });
  it("rejects encrypted PDFs instead of trying to get around the protection", async () => {
    await expect(inspectPdf(encryptedPdf())).rejects.toMatchObject({ problem: "encrypted" });
  });
  it("rejects files over the size limit", async () => {
    const big = new Uint8Array(15 * 1024 * 1024 + 1);
    big.set(new TextEncoder().encode("%PDF-1.4"));
    await expect(inspectPdf(big)).rejects.toMatchObject({ problem: "too_large" });
  });
});
