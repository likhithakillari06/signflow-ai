import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { CleanValue, FieldDef } from "../fields";
import { containRect, normToDisplayRect, placementForDisplayRect, type DisplayRect, type PageGeometry } from "./coords";
import { pageGeometry } from "./inspect";

export class FinalizeError extends Error {}

export type CertificateInfo = {
  agreementTitle: string;
  workspaceName: string;
  agreementId: string;
  originalSha256: string;
  signerName: string;
  signerEmail: string;
  signedAtIso: string;
  ip: string | null;
  userAgent: string | null;
  consentText: string;
  events: { at: string; label: string }[];
};

const INK = rgb(0.06, 0.09, 0.22);

let unicodeFontBytes: Promise<Uint8Array> | undefined;
function loadUnicodeFont(): Promise<Uint8Array> {
  unicodeFontBytes ??= readFile(path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf")).then((b) => new Uint8Array(b));
  return unicodeFontBytes;
}

/** Picks Helvetica when it can encode the text, otherwise a bundled Unicode font. */
class FontPicker {
  private helvetica?: PDFFont;
  private unicode?: PDFFont;
  private unicodeChars?: Set<number>;
  constructor(private doc: PDFDocument) {}

  async for(text: string): Promise<PDFFont> {
    this.helvetica ??= await this.doc.embedFont(StandardFonts.Helvetica);
    try {
      this.helvetica.encodeText(text);
      return this.helvetica;
    } catch {
      // not WinAnsi — fall through
    }
    if (!this.unicode) {
      this.doc.registerFontkit(fontkit);
      this.unicode = await this.doc.embedFont(await loadUnicodeFont(), { subset: true });
      this.unicodeChars = new Set(this.unicode.getCharacterSet());
    }
    const missing = [...text].filter((ch) => !this.unicodeChars!.has(ch.codePointAt(0)!));
    if (missing.length > 0) {
      throw new FinalizeError(
        `Some characters cannot be printed on the document: ${[...new Set(missing)].slice(0, 8).join(" ")}. Please use Latin, Greek or Cyrillic letters.`,
      );
    }
    return this.unicode;
  }
}

function drawTextInBox(page: PDFPage, g: PageGeometry, box: DisplayRect, text: string, font: PDFFont) {
  const padding = Math.min(3, box.w * 0.04);
  let size = Math.min(Math.max(box.h * 0.6, 5), 13);
  const maxWidth = Math.max(box.w - padding * 2, 4);
  while (size > 4.5 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25;
  // Baseline so the text sits vertically centred in the box.
  const baselineV = box.v + box.h / 2 + size * 0.35;
  const p = placementForDisplayRect(g, { u: box.u + padding, v: baselineV, w: 0, h: 0 });
  page.drawText(text, { x: p.x, y: p.y, size, font, color: INK, rotate: degrees(p.rotateDegrees) });
}

/**
 * Produces the completed document: the untouched original with the signer's values drawn on
 * top at the saved field positions, plus a certificate page appended at the end.
 *
 * This embeds a *visual* electronic signature. It is not a cryptographic (PKI) digital
 * signature; integrity is evidenced by the stored SHA-256 hashes and the audit trail.
 */
export async function buildSignedPdf(input: {
  original: Uint8Array;
  fields: FieldDef[];
  values: CleanValue[];
  certificate?: CertificateInfo;
}): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input.original, { updateMetadata: false });
  } catch {
    throw new FinalizeError("The original document could not be opened to apply the signature.");
  }
  const pages = doc.getPages();
  const fonts = new FontPicker(doc);
  const byField = new Map(input.values.map((v) => [v.fieldId, v]));

  for (const field of input.fields) {
    const value = byField.get(field.id);
    if (!value) continue; // optional field left empty
    const page = pages[field.page_number - 1];
    if (!page) throw new FinalizeError(`A field refers to page ${field.page_number}, which does not exist.`);
    const g = pageGeometry(page);
    const box = normToDisplayRect(g, field);

    if (value.kind === "image") {
      let image;
      try {
        image = await doc.embedPng(value.png);
      } catch {
        throw new FinalizeError("The signature image could not be read. Please clear it and sign again.");
      }
      const inner = containRect(box, image.width, image.height, Math.min(2, box.h * 0.05));
      const p = placementForDisplayRect(g, inner);
      page.drawImage(image, { x: p.x, y: p.y, width: p.width, height: p.height, rotate: degrees(p.rotateDegrees) });
    } else {
      drawTextInBox(page, g, box, value.text, await fonts.for(value.text));
    }
  }

  if (input.certificate) await appendCertificate(doc, fonts, input.certificate);

  return doc.save();
}

async function appendCertificate(doc: PDFDocument, fonts: FontPicker, c: CertificateInfo) {
  const page = doc.addPage([612, 792]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const grey = rgb(0.4, 0.43, 0.5);
  const left = 56;
  let y = 730;

  page.drawText("Signature Certificate", { x: left, y, size: 20, font: bold, color: INK });
  y -= 18;
  page.drawText("Added by SignFlow AI when the agreement was signed. Not part of the original document.", {
    x: left, y, size: 9, font: await fonts.for("a"), color: grey,
  });
  y -= 14;
  page.drawLine({ start: { x: left, y }, end: { x: 556, y }, thickness: 0.75, color: rgb(0.85, 0.87, 0.91) });
  y -= 26;

  const row = async (label: string, value: string) => {
    page.drawText(label.toUpperCase(), { x: left, y, size: 7.5, font: bold, color: grey });
    const lines = wrap(value, 78);
    for (const line of lines) {
      page.drawText(line, { x: left + 130, y, size: 10, font: await fonts.for(line), color: INK });
      y -= 14;
    }
    y -= 6;
  };

  await row("Agreement", c.agreementTitle);
  await row("Sent by", c.workspaceName);
  await row("Agreement ID", c.agreementId);
  await row("Original SHA-256", c.originalSha256);
  await row("Signer", `${c.signerName} <${c.signerEmail}>`);
  await row("Signed at", c.signedAtIso);
  await row("IP address", c.ip ?? "not recorded");
  await row("Browser", c.userAgent ?? "not recorded");
  await row("Consent", c.consentText);

  y -= 6;
  page.drawText("History", { x: left, y, size: 12, font: bold, color: INK });
  y -= 20;
  for (const e of c.events.slice(-14)) {
    if (y < 70) break;
    page.drawText(e.at, { x: left, y, size: 9, font: await fonts.for(e.at), color: grey });
    page.drawText(e.label, { x: left + 150, y, size: 9, font: await fonts.for(e.label), color: INK });
    y -= 14;
  }

  page.drawText(
    "This records an electronic signature and who provided it. It is not a cryptographic digital signature.",
    { x: left, y: 44, size: 8, font: await fonts.for("a"), color: grey },
  );
}

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const chunks = word.length > max ? word.match(new RegExp(`.{1,${max}}`, "g"))! : [word];
    for (const w of chunks) {
      if ((line + " " + w).trim().length > max) {
        if (line) out.push(line);
        line = w;
      } else {
        line = (line + " " + w).trim();
      }
    }
  }
  if (line) out.push(line);
  return out.length ? out.slice(0, 4) : [""];
}
