// Copies the PDF.js worker, character maps and standard fonts into /public so the browser
// loads them from our own origin (no third-party CDN, works for PDFs with non-embedded fonts).
import { cpSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "node_modules/pdfjs-dist");
if (existsSync(pkg)) {
  mkdirSync(join(root, "public/pdfjs"), { recursive: true });
  copyFileSync(join(pkg, "legacy/build/pdf.worker.min.mjs"), join(root, "public/pdf.worker.min.mjs"));
  cpSync(join(pkg, "cmaps"), join(root, "public/pdfjs/cmaps"), { recursive: true });
  cpSync(join(pkg, "standard_fonts"), join(root, "public/pdfjs/standard_fonts"), { recursive: true });
  console.log("PDF.js assets copied to public/");
} else {
  console.warn("pdfjs-dist not installed yet; skipping PDF.js asset copy");
}
