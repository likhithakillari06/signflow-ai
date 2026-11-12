"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Eye, EyeOff, Loader2, MousePointerClick, PenLine, Save, Trash2, Type, User, CaseSensitive } from "lucide-react";
import { toast } from "sonner";
import { saveAgreementSetupAction, saveTemplateFieldsAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { FIELD_DEFAULT_SIZE, FIELD_LABEL, FIELD_TYPES, validateFieldLayout, type FieldType } from "@/lib/fields";
import { clampNormRect } from "@/lib/pdf/coords";
import { cn } from "@/lib/utils";
import { PdfPages, fetchDocumentBytes, type PageInfo } from "./pdf-pages";

export type EditorField = {
  key: string; page_number: number; field_type: FieldType; x: number; y: number; width: number; height: number; required: boolean; label: string | null;
};

const ICON: Record<FieldType, React.ComponentType<{ className?: string }>> = {
  signature: PenLine, initials: CaseSensitive, name: User, date: CalendarDays, text: Type,
};
const COLOR: Record<FieldType, string> = {
  signature: "border-indigo-500 bg-indigo-500/15 text-indigo-900",
  initials: "border-violet-500 bg-violet-500/15 text-violet-900",
  name: "border-sky-500 bg-sky-500/15 text-sky-900",
  date: "border-emerald-500 bg-emerald-500/15 text-emerald-900",
  text: "border-amber-500 bg-amber-500/20 text-amber-900",
};

type Props =
  | { mode: "agreement"; id: string; documentUrl: string; initialFields: Omit<EditorField, "key">[]; signer: { name: string; email: string }; pageCount: number }
  | { mode: "template"; id: string; documentUrl: string; initialFields: Omit<EditorField, "key">[]; pageCount: number; signer?: undefined };

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));

export function FieldEditor(props: Props) {
  const router = useRouter();
  const [fields, setFields] = useState<EditorField[]>(() => props.initialFields.map((f) => ({ ...f, key: newKey() })));
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<FieldType | null>(null);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signerName, setSignerName] = useState(props.signer?.name ?? "");
  const [signerEmail, setSignerEmail] = useState(props.signer?.email ?? "");

  const load = useCallback(
    () =>
      fetchDocumentBytes(async () => {
        const res = await fetch(props.documentUrl, { cache: "no-store" });
        if (!res.ok) throw new Error("not authorised");
        return ((await res.json()) as { url: string }).url;
      }),
    [props.documentUrl],
  );

  const update = useCallback((key: string, patch: Partial<EditorField>) => {
    setFields((all) => all.map((f) => (f.key === key ? { ...f, ...patch } : f)));
    setDirty(true);
  }, []);
  const remove = useCallback((key: string) => {
    setFields((all) => all.filter((f) => f.key !== key));
    setSelected((s) => (s === key ? null : s));
    setDirty(true);
  }, []);

  const placeAt = (page: PageInfo, fx: number, fy: number, type: FieldType) => {
    const size = FIELD_DEFAULT_SIZE[type];
    const width = Math.min(size.width / page.width, 0.9);
    const height = Math.min(size.height / page.height, 0.5);
    const rect = clampNormRect({ x: fx - width / 2, y: fy - height / 2, width, height });
    const key = newKey();
    setFields((all) => [...all, { key, page_number: page.pageNumber, field_type: type, ...rect, required: true, label: null }]);
    setSelected(key);
    setTool(null);
    setDirty(true);
  };

  // Keyboard: delete removes, arrows nudge the selected field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "Escape") { setTool(null); return; }
      if (!selected) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(selected); return; }
      const step = e.shiftKey ? 0.01 : 0.002;
      const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const d = delta[e.key];
      if (!d) return;
      e.preventDefault();
      setFields((all) => all.map((f) => (f.key === selected ? { ...f, ...clampNormRect({ x: f.x + d[0], y: f.y + d[1], width: f.width, height: f.height }) } : f)));
      setDirty(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, remove]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const problems = useMemo(() => validateFieldLayout(fields, props.pageCount), [fields, props.pageCount]);
  const current = fields.find((f) => f.key === selected) ?? null;

  const save = async (thenContinue: boolean) => {
    setSaving(true);
    const payload = fields.map(({ key: _key, ...f }) => ({ ...f, label: f.label?.trim() || null }));
    const res =
      props.mode === "agreement"
        ? await saveAgreementSetupAction({ agreementId: props.id, fields: payload, signer: { name: signerName, email: signerEmail } })
        : await saveTemplateFieldsAction(props.id, payload);
    setSaving(false);
    if (!res.ok) { toast.error(res.error); return; }
    setDirty(false);
    if (res.data.problems.length > 0) {
      toast.warning(`Saved as draft. ${res.data.problems[0]}`);
      return;
    }
    toast.success(props.mode === "agreement" ? "Fields saved. The agreement is ready to send." : "Template saved.");
    if (thenContinue) router.push(props.mode === "agreement" ? `/agreements/${props.id}` : "/templates");
    else router.refresh();
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="order-2 min-w-0 lg:order-1">
        {tool ? (
          <div className="sticky top-14 z-20 mb-3 flex items-center justify-between gap-3 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900 lg:top-2">
            <span className="flex items-center gap-2"><MousePointerClick className="size-4" /> Click on the document where the <b>{FIELD_LABEL[tool].toLowerCase()}</b> should go.</span>
            <button className="text-xs font-medium underline" onClick={() => setTool(null)}>Cancel</button>
          </div>
        ) : null}
        <PdfPages
          load={load}
          renderOverlay={(page) => (
            <div
              className={cn("absolute inset-0", tool ? "cursor-crosshair" : "")}
              data-testid={`page-overlay-${page.pageNumber}`}
              onPointerDown={(e) => { if (e.target === e.currentTarget && !tool) setSelected(null); }}
              onClick={(e) => {
                if (!tool || e.target !== e.currentTarget) return;
                const r = e.currentTarget.getBoundingClientRect();
                placeAt(page, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, tool);
              }}
            >
              {fields.filter((f) => f.page_number === page.pageNumber).map((f) => (
                <FieldBox
                  key={f.key}
                  field={f}
                  selected={selected === f.key}
                  preview={preview}
                  previewName={signerName || "Signer Name"}
                  passive={!!tool}
                  onSelect={() => setSelected(f.key)}
                  onChange={(rect) => update(f.key, rect)}
                />
              ))}
            </div>
          )}
        />
      </div>

      <aside className="order-1 lg:order-2">
        <div className="space-y-4 lg:sticky lg:top-4">
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold">Add a field</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Pick a field, then click on the page. Drag to move, pull the corner to resize.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
              {FIELD_TYPES.map((t) => {
                const Icon = ICON[t];
                return (
                  <button
                    key={t}
                    type="button"
                    data-testid={`tool-${t}`}
                    onClick={() => { setTool(tool === t ? null : t); setPreview(false); }}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors",
                      tool === t ? "border-primary bg-accent text-accent-foreground" : "hover:bg-secondary",
                    )}
                  >
                    <Icon className="size-4" /> {FIELD_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>

          {current ? (
            <div className="rounded-lg border bg-card p-4 shadow-sm" data-testid="field-properties">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{FIELD_LABEL[current.field_type]} · page {current.page_number}</h2>
                <Button variant="ghost" size="icon" aria-label="Delete field" onClick={() => remove(current.key)}><Trash2 className="text-red-600" /></Button>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-indigo-600" checked={current.required} onChange={(e) => update(current.key, { required: e.target.checked })} />
                Required
              </label>
              {current.field_type === "text" ? (
                <div className="mt-3">
                  <Field label="Label shown to the signer" htmlFor="field-label" hint="For example: Address, Phone number">
                    <Input id="field-label" value={current.label ?? ""} maxLength={80} onChange={(e) => update(current.key, { label: e.target.value })} />
                  </Field>
                </div>
              ) : null}
              {props.mode === "agreement" ? <p className="mt-3 text-xs text-muted-foreground">Assigned to: {signerName || "the signer"}</p> : null}
              {current.field_type === "date" ? <p className="mt-2 text-xs text-muted-foreground">Filled in automatically with the date of signing.</p> : null}
            </div>
          ) : null}

          {props.mode === "agreement" ? (
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold">Signer</h2>
              <div className="mt-3 grid gap-3">
                <Field label="Full name" htmlFor="signer-name">
                  <Input id="signer-name" value={signerName} maxLength={160} onChange={(e) => { setSignerName(e.target.value); setDirty(true); }} />
                </Field>
                <Field label="Email" htmlFor="signer-email">
                  <Input id="signer-email" type="email" value={signerEmail} maxLength={254} onChange={(e) => { setSignerEmail(e.target.value); setDirty(true); }} />
                </Field>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold" data-testid="field-count">{fields.length} field{fields.length === 1 ? "" : "s"}</span>
              <button type="button" className="flex items-center gap-1.5 text-xs font-medium text-primary" onClick={() => { setPreview((p) => !p); setTool(null); }}>
                {preview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {preview ? "Back to editing" : "Preview as signed"}
              </button>
            </div>
            {problems.length > 0 ? <Alert tone="warn" className="mt-3">{problems[0]}</Alert> : null}
            <div className="mt-3 grid gap-2">
              <Button onClick={() => save(true)} disabled={saving} data-testid="save-continue">
                {saving ? <Loader2 className="animate-spin" /> : <Save />} {props.mode === "agreement" ? "Save and continue" : "Save template"}
              </Button>
              <Button variant="outline" onClick={() => save(false)} disabled={saving || !dirty}>Save</Button>
            </div>
            {dirty ? <p className="mt-2 text-xs text-amber-700">You have unsaved changes.</p> : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

function FieldBox({
  field, selected, preview, previewName, passive, onSelect, onChange,
}: {
  field: EditorField; selected: boolean; preview: boolean; previewName: string; passive: boolean;
  onSelect: () => void; onChange: (rect: { x: number; y: number; width: number; height: number }) => void;
}) {
  const drag = useRef<{ mode: "move" | "resize"; px: number; py: number; start: EditorField; w: number; h: number } | null>(null);
  const Icon = ICON[field.field_type];

  const begin = (mode: "move" | "resize") => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || preview || passive) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const overlay = (e.currentTarget.closest("[data-testid^='page-overlay-']") as HTMLElement).getBoundingClientRect();
    drag.current = { mode, px: e.clientX, py: e.clientY, start: field, w: overlay.width, h: overlay.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) / d.w;
    const dy = (e.clientY - d.py) / d.h;
    if (d.mode === "move") {
      onChange(clampNormRect({ x: d.start.x + dx, y: d.start.y + dy, width: d.start.width, height: d.start.height }));
    } else {
      const width = Math.min(Math.max(d.start.width + dx, 0.03), 1 - d.start.x);
      const height = Math.min(Math.max(d.start.height + dy, 0.012), 1 - d.start.y);
      onChange({ x: d.start.x, y: d.start.y, width, height });
    }
  };
  const end = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  const style = { left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%` };
  const sample =
    field.field_type === "signature" ? previewName
    : field.field_type === "initials" ? previewName.split(/\s+/).map((p) => p[0]).join("").slice(0, 3).toUpperCase()
    : field.field_type === "name" ? previewName
    : field.field_type === "date" ? new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date())
    : field.label || "Sample text";

  if (preview) {
    return (
      <div className="pointer-events-none absolute flex items-center overflow-hidden px-[2%]" style={{ ...style, containerType: "size" }}>
        <span className={cn("whitespace-nowrap leading-none text-slate-900", field.field_type === "signature" || field.field_type === "initials" ? "font-signature" : "")}
          style={{ fontSize: field.field_type === "signature" || field.field_type === "initials" ? "70cqh" : "55cqh" }}>
          {sample}
        </span>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`field-${field.field_type}`}
      data-selected={selected}
      aria-label={`${FIELD_LABEL[field.field_type]} field on page ${field.page_number}`}
      className={cn(
        "absolute flex touch-none select-none items-center gap-1 overflow-hidden rounded-[3px] border-2 px-1 text-[11px] font-semibold leading-none",
        COLOR[field.field_type],
        passive ? "pointer-events-none opacity-70" : "cursor-move",
        selected ? "ring-2 ring-indigo-600 ring-offset-1" : "",
        field.required ? "" : "border-dashed",
      )}
      style={style}
      onPointerDown={begin("move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onFocus={onSelect}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{field.label || FIELD_LABEL[field.field_type]}{field.required ? " *" : ""}</span>
      {selected ? (
        <span
          data-testid="resize-handle"
          className="absolute -bottom-0.5 -right-0.5 size-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-indigo-600"
          onPointerDown={begin("resize")}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ) : null}
    </div>
  );
}
