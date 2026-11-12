import { z } from "zod";

export const FIELD_TYPES = ["signature", "initials", "name", "date", "text"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_LABEL: Record<FieldType, string> = {
  signature: "Signature",
  initials: "Initials",
  name: "Full name",
  date: "Date signed",
  text: "Text",
};

/** Default field size in PDF points; converted to page fractions when a field is added. */
export const FIELD_DEFAULT_SIZE: Record<FieldType, { width: number; height: number }> = {
  signature: { width: 190, height: 52 },
  initials: { width: 64, height: 40 },
  name: { width: 190, height: 24 },
  date: { width: 120, height: 24 },
  text: { width: 190, height: 24 },
};

export const MAX_FIELDS = 100;
export const MAX_TEXT_LENGTH = 200;
export const MAX_SIGNATURE_BYTES = 400 * 1024;

export type FieldDef = {
  id: string;
  page_number: number;
  field_type: FieldType;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label: string | null;
};

const fraction = z.number().finite().min(0).max(1);

export const fieldInputSchema = z
  .object({
    page_number: z.number().int().min(1),
    field_type: z.enum(FIELD_TYPES),
    x: fraction,
    y: fraction,
    width: z.number().finite().gt(0).max(1),
    height: z.number().finite().gt(0).max(1),
    required: z.boolean(),
    label: z.string().trim().max(80).nullable().optional(),
  })
  .refine((f) => f.x + f.width <= 1.0005 && f.y + f.height <= 1.0005, {
    message: "Field must sit inside the page",
  });
export type FieldInput = z.infer<typeof fieldInputSchema>;

export const fieldsInputSchema = z.array(fieldInputSchema).max(MAX_FIELDS);

/** Layout-level checks before an agreement can be marked Ready. */
export function validateFieldLayout(fields: FieldInput[], pageCount: number): string[] {
  const problems: string[] = [];
  if (!fields.some((f) => f.field_type === "signature")) {
    problems.push("Add at least one signature field.");
  }
  for (const f of fields) {
    if (f.page_number > pageCount) {
      problems.push(`A field is placed on page ${f.page_number}, but the document has ${pageCount} page(s).`);
      break;
    }
  }
  if (fields.some((f) => f.field_type === "signature" && !f.required)) {
    // Allowed, but there must be at least one required signature overall.
    if (!fields.some((f) => f.field_type === "signature" && f.required)) {
      problems.push("At least one signature field must be required.");
    }
  }
  return problems;
}

// ---- Signer submission -------------------------------------------------------------------

export const submittedValueSchema = z.object({
  fieldId: z.string().uuid(),
  text: z.string().max(2000).optional(),
  image: z.string().max(Math.ceil(MAX_SIGNATURE_BYTES * 1.4) + 64).optional(),
  method: z.enum(["drawn", "typed"]).optional(),
});
export type SubmittedValue = z.infer<typeof submittedValueSchema>;

export type CleanValue =
  | { fieldId: string; kind: "text"; text: string }
  | { fieldId: string; kind: "image"; png: Uint8Array; method: "drawn" | "typed" };

export type SubmissionResult =
  | { ok: true; values: CleanValue[] }
  | { ok: false; errors: { fieldId: string | null; message: string }[] };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function decodePngDataUrl(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Uint8Array.from(Buffer.from(m[1], "base64"));
  if (bytes.length < 67 || bytes.length > MAX_SIGNATURE_BYTES) return null;
  for (let i = 0; i < PNG_MAGIC.length; i++) if (bytes[i] !== PNG_MAGIC[i]) return null;
  return bytes;
}

/** Collapse whitespace and drop control characters; signer text is drawn on a single line. */
export function cleanText(input: string): string {
  return input.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Checks what the signer submitted against the saved field definitions. Pure and server-side:
 * the browser's own validation is a convenience, this is the authority.
 *  - every required field has a value
 *  - values only for fields that belong to this agreement
 *  - signatures/initials are real PNG images within the size limit
 *  - the date field is always filled by the server (`signedDateText`), never by the client
 */
export function validateSubmission(fields: FieldDef[], submitted: SubmittedValue[], signedDateText: string): SubmissionResult {
  const errors: { fieldId: string | null; message: string }[] = [];
  const byId = new Map<string, SubmittedValue>();
  const known = new Set(fields.map((f) => f.id));
  for (const v of submitted) {
    if (!known.has(v.fieldId)) {
      errors.push({ fieldId: null, message: "A submitted value does not belong to this agreement." });
      continue;
    }
    if (byId.has(v.fieldId)) {
      errors.push({ fieldId: v.fieldId, message: "A field was submitted twice." });
      continue;
    }
    byId.set(v.fieldId, v);
  }

  const values: CleanValue[] = [];
  for (const f of fields) {
    const v = byId.get(f.id);
    const label = f.label || FIELD_LABEL[f.field_type];
    if (f.field_type === "date") {
      values.push({ fieldId: f.id, kind: "text", text: signedDateText });
      continue;
    }
    if (f.field_type === "signature" || f.field_type === "initials") {
      if (!v?.image) {
        if (f.required) errors.push({ fieldId: f.id, message: `${label} on page ${f.page_number} is required.` });
        continue;
      }
      const png = decodePngDataUrl(v.image);
      if (!png) {
        errors.push({ fieldId: f.id, message: `${label} on page ${f.page_number} is not a valid image.` });
        continue;
      }
      values.push({ fieldId: f.id, kind: "image", png, method: v.method ?? "drawn" });
      continue;
    }
    const text = cleanText(v?.text ?? "");
    if (text === "") {
      if (f.required) errors.push({ fieldId: f.id, message: `${label} on page ${f.page_number} is required.` });
      continue;
    }
    if (text.length > MAX_TEXT_LENGTH) {
      errors.push({ fieldId: f.id, message: `${label} is too long (max ${MAX_TEXT_LENGTH} characters).` });
      continue;
    }
    values.push({ fieldId: f.id, kind: "text", text });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}

export function formatSignedDate(date: Date, timeZone?: string): string {
  let tz = "UTC";
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
      tz = timeZone;
    } catch {
      tz = "UTC";
    }
  }
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: tz }).format(date);
}
