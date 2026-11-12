/** TEST ONLY. Builds PDFs the application has never seen, in awkward shapes. */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export type PageSpec = { width: number; height: number; rotate?: 0 | 90 | 180 | 270; cropBox?: [number, number, number, number]; unbalancedState?: boolean };

export async function makePdf(pages: PageSpec[], label = "Unfamiliar agreement"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((spec, i) => {
    const page = doc.addPage([spec.width, spec.height]);
    page.drawRectangle({ x: 12, y: 12, width: spec.width - 24, height: spec.height - 24, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1 });
    page.drawText(`${label} — page ${i + 1}`, { x: 40, y: spec.height - 60, size: 14, font, color: rgb(0.2, 0.2, 0.2) });
    for (let l = 0; l < 6; l++) page.drawText("The parties agree to the terms set out in this document.", { x: 40, y: spec.height - 100 - l * 16, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
    if (spec.rotate) page.setRotation(degrees(spec.rotate));
    if (spec.cropBox) page.setCropBox(...spec.cropBox);
  });
  return doc.save();
}

export const letterTwoPages = () => makePdf([{ width: 612, height: 792 }, { width: 612, height: 792 }]);

/** A structurally valid PDF whose trailer declares encryption. */
export function encryptedPdf(): Uint8Array {
  const body = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
4 0 obj<</Filter/Standard/V 1/R 2/O(aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)/U(bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb)/P -44>>endobj
trailer<</Root 1 0 R/Size 5/Encrypt 4 0 R/ID[<00><00>]>>
%%EOF`;
  return new TextEncoder().encode(body);
}

/** 1x1-ish PNG with visible ink, as a data URL, for signature fields. */
export async function inkPngDataUrl(width = 300, height = 100): Promise<string> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#0f1738";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(10, height - 20);
  ctx.bezierCurveTo(width * 0.3, 0, width * 0.5, height, width - 10, 20);
  ctx.stroke();
  ctx.fillStyle = "#0f1738";
  ctx.fillRect(width * 0.35, height * 0.35, width * 0.3, height * 0.3);
  return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
}
