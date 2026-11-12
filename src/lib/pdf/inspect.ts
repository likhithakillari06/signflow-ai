import { PDFDocument, type PDFPage } from "pdf-lib";
import { normalizeRotation, type PageGeometry } from "./coords";

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_MB = 15;
export const MAX_PAGES = 300;

export type PdfProblem = "empty" | "too_large" | "not_pdf" | "encrypted" | "corrupt" | "no_pages" | "too_many_pages";

export const PDF_PROBLEM_MESSAGE: Record<PdfProblem, string> = {
  empty: "The file is empty.",
  too_large: `The file is larger than the ${MAX_PDF_MB} MB limit.`,
  not_pdf: "This file is not a PDF. Please upload a PDF document.",
  encrypted: "This PDF is password-protected or encrypted. Remove the protection and upload it again.",
  corrupt: "This PDF could not be read. It may be damaged; try re-saving or re-exporting it.",
  no_pages: "This PDF has no pages.",
  too_many_pages: `This PDF has more than ${MAX_PAGES} pages.`,
};

export class PdfValidationError extends Error {
  constructor(public readonly problem: PdfProblem) {
    super(PDF_PROBLEM_MESSAGE[problem]);
  }
}

export type PdfInfo = { pageCount: number; pages: PageGeometry[] };

/** The box a viewer shows: CropBox clipped to MediaBox (same rule PDF.js uses). */
export function pageGeometry(page: PDFPage): PageGeometry {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const left = Math.max(media.x, crop.x);
  const bottom = Math.max(media.y, crop.y);
  const right = Math.min(media.x + media.width, crop.x + crop.width);
  const top = Math.min(media.y + media.height, crop.y + crop.height);
  const usable = right - left > 0 && top - bottom > 0;
  const box = usable ? { x: left, y: bottom, width: right - left, height: top - bottom } : media;
  return { x0: box.x, y0: box.y, width: box.width, height: box.height, rotation: normalizeRotation(page.getRotation().angle) };
}

/**
 * Server-side check that the bytes really are a PDF we can sign. Does not trust the file
 * extension or the browser-supplied MIME type, and never tries to get around encryption.
 */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInfo> {
  if (bytes.length === 0) throw new PdfValidationError("empty");
  if (bytes.length > MAX_PDF_BYTES) throw new PdfValidationError("too_large");
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (!head.includes("%PDF-")) throw new PdfValidationError("not_pdf");

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(message)) throw new PdfValidationError("encrypted");
    throw new PdfValidationError("corrupt");
  }
  if (doc.isEncrypted) throw new PdfValidationError("encrypted");

  let pages: PageGeometry[];
  try {
    pages = doc.getPages().map(pageGeometry);
  } catch {
    throw new PdfValidationError("corrupt");
  }
  if (pages.length === 0) throw new PdfValidationError("no_pages");
  if (pages.length > MAX_PAGES) throw new PdfValidationError("too_many_pages");
  return { pageCount: pages.length, pages };
}
