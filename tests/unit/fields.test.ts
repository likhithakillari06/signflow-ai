import { describe, expect, it } from "vitest";
import { fieldInputSchema, formatSignedDate, validateFieldLayout, validateSubmission, type FieldDef } from "@/lib/fields";

const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]).toString("base64")}`;
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const field = (n: number, field_type: FieldDef["field_type"], required = true): FieldDef => ({
  id: id(n), page_number: 1, field_type, x: 0.1, y: 0.1, width: 0.3, height: 0.05, required, label: null,
});

describe("signature-field validation (layout)", () => {
  const base = { page_number: 1, field_type: "signature" as const, x: 0.1, y: 0.1, width: 0.3, height: 0.05, required: true };

  it("accepts a field inside the page", () => {
    expect(fieldInputSchema.safeParse(base).success).toBe(true);
  });
  it("rejects fields that leave the page, have no size, or unknown types", () => {
    expect(fieldInputSchema.safeParse({ ...base, x: 0.9, width: 0.3 }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, y: 1.2 }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, width: 0 }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, x: Number.NaN }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, field_type: "stamp" }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, page_number: 0 }).success).toBe(false);
  });
  it("requires at least one required signature field before an agreement is ready", () => {
    expect(validateFieldLayout([], 2)).toContain("Add at least one signature field.");
    expect(validateFieldLayout([{ ...base, field_type: "date" }], 2)).toHaveLength(1);
    expect(validateFieldLayout([{ ...base, required: false }], 2)).toEqual(["At least one signature field must be required."]);
    expect(validateFieldLayout([base], 2)).toEqual([]);
  });
  it("rejects fields on pages the document does not have", () => {
    expect(validateFieldLayout([{ ...base, page_number: 3 }], 2)[0]).toMatch(/page 3/);
  });
});

describe("required-field validation (submission)", () => {
  const fields = [field(1, "signature"), field(2, "name"), field(3, "date"), field(4, "text", false), field(5, "initials", false)];

  it("accepts a complete submission and fills the date on the server", () => {
    const r = validateSubmission(fields, [{ fieldId: id(1), image: PNG, method: "drawn" }, { fieldId: id(2), text: "  Jordan   Example " }], "Nov 10, 2026");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.find((v) => v.fieldId === id(2))).toEqual({ fieldId: id(2), kind: "text", text: "Jordan Example" });
    expect(r.values.find((v) => v.fieldId === id(3))).toEqual({ fieldId: id(3), kind: "text", text: "Nov 10, 2026" });
    expect(r.values.some((v) => v.fieldId === id(4))).toBe(false); // optional, left empty
  });

  it("ignores a client-supplied date", () => {
    const r = validateSubmission(fields, [{ fieldId: id(1), image: PNG }, { fieldId: id(2), text: "J" }, { fieldId: id(3), text: "Jan 1, 1999" }], "Nov 10, 2026");
    expect(r.ok && r.values.find((v) => v.fieldId === id(3))).toMatchObject({ text: "Nov 10, 2026" });
  });

  it("reports every missing required field", () => {
    const r = validateSubmission(fields, [], "x");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.fieldId)).toEqual([id(1), id(2)]);
  });

  it("treats whitespace-only text as missing", () => {
    const r = validateSubmission(fields, [{ fieldId: id(1), image: PNG }, { fieldId: id(2), text: "   \n " }], "x");
    expect(r.ok).toBe(false);
  });

  it("rejects signatures that are not real PNG images", () => {
    for (const image of ["data:image/png;base64,AAAA", "data:text/html;base64,PHNjcmlwdD4=", "javascript:alert(1)", "not-a-data-url"]) {
      const r = validateSubmission(fields, [{ fieldId: id(1), image }, { fieldId: id(2), text: "J" }], "x");
      expect(r.ok).toBe(false);
    }
  });

  it("rejects values for fields that are not part of the agreement, and duplicates", () => {
    const foreign = validateSubmission(fields, [{ fieldId: id(1), image: PNG }, { fieldId: id(2), text: "J" }, { fieldId: id(9), text: "x" }], "x");
    expect(foreign.ok).toBe(false);
    const dupe = validateSubmission(fields, [{ fieldId: id(1), image: PNG }, { fieldId: id(2), text: "J" }, { fieldId: id(2), text: "K" }], "x");
    expect(dupe.ok).toBe(false);
  });

  it("strips control characters and limits length", () => {
    const ok = validateSubmission(fields, [{ fieldId: id(1), image: PNG }, { fieldId: id(2), text: "Jo\u0000rdan\tExample" }], "x");
    expect(ok.ok && ok.values.find((v) => v.fieldId === id(2))).toMatchObject({ text: "Jo rdan Example" });
    const long = validateSubmission(fields, [{ fieldId: id(1), image: PNG }, { fieldId: id(2), text: "x".repeat(201) }], "x");
    expect(long.ok).toBe(false);
  });
});

describe("formatSignedDate", () => {
  const instant = new Date("2026-11-10T23:30:00Z");
  it("uses the signer's time zone when valid", () => {
    expect(formatSignedDate(instant, "Asia/Kolkata")).toBe("Nov 11, 2026");
    expect(formatSignedDate(instant, "America/New_York")).toBe("Nov 10, 2026");
  });
  it("falls back to UTC for missing or bogus zones", () => {
    expect(formatSignedDate(instant)).toBe("Nov 10, 2026");
    expect(formatSignedDate(instant, "Mars/Olympus")).toBe("Nov 10, 2026");
  });
});
