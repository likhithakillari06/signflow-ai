/**
 * TEST ONLY. Renders a PDF page exactly as a viewer would (PDF.js, rotation and crop box
 * applied) and measures how much "ink" is inside/outside a rectangle given in display
 * fractions — the same coordinate system the field editor stores.
 */
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const ASSETS = path.resolve("node_modules/pdfjs-dist");

type Rect = { x: number; y: number; width: number; height: number };

export async function renderPage(pdf: Uint8Array, pageNumber: number, scale = 1.5) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableFontFace: true, isEvalSupported: false, verbosity: 0,
    standardFontDataUrl: `${ASSETS}/standard_fonts/`, cMapUrl: `${ASSETS}/cmaps/`, cMapPacked: true, }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as never, viewport }).promise;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = { width: canvas.width, height: canvas.height, data: image.data, pageCount: doc.numPages, viewWidth: viewport.width / scale, viewHeight: viewport.height / scale };
  await doc.destroy();
  return result;
}

/** Number of pixels that differ noticeably between two renders, inside and outside `rect`. */
export function diffInk(a: { width: number; height: number; data: Uint8ClampedArray }, b: typeof a, rect: Rect, margin = 0.01) {
  if (a.width !== b.width || a.height !== b.height) throw new Error("renders differ in size");
  const x0 = (rect.x - margin) * a.width, x1 = (rect.x + rect.width + margin) * a.width;
  const y0 = (rect.y - margin) * a.height, y1 = (rect.y + rect.height + margin) * a.height;
  let inside = 0, outside = 0;
  let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 90) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) inside++;
        else outside++;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const bounds = maxX < 0 ? null : { x: minX / a.width, y: minY / a.height, width: (maxX - minX) / a.width, height: (maxY - minY) / a.height };
  return { inside, outside, bounds };
}
