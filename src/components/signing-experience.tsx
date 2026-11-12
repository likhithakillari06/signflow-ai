"use client";
import { useCallback, useMemo, useState } from "react";
import { ArrowDown, CalendarDays, Check, Download, Loader2, Lock, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FIELD_LABEL, MAX_TEXT_LENGTH, type FieldDef } from "@/lib/fields";
import { cn } from "@/lib/utils";
import { PdfPages, fetchDocumentBytes } from "./pdf-pages";
import { SignatureDialog, type Adopted } from "./signature-dialog";

type Value = { text?: string; image?: string; method?: "drawn" | "typed" };

type Props = {
  token: string; workspaceName: string; title: string; signerName: string; fields: FieldDef[]; consentText: string; expiresAt: string;
};

export function SigningExperience({ token, workspaceName, title, signerName, fields, consentText }: Props) {
  const [values, setValues] = useState<Record<string, Value>>(() =>
    Object.fromEntries(fields.filter((f) => f.field_type === "name").map((f) => [f.id, { text: signerName }])),
  );
  const [adopted, setAdopted] = useState<{ signature?: Adopted; initials?: Adopted }>({});
  const [sigTarget, setSigTarget] = useState<FieldDef | null>(null);
  const [textTarget, setTextTarget] = useState<FieldDef | null>(null);
  const [draft, setDraft] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);

  const today = useMemo(() => new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date()), []);

  const load = useCallback(
    () =>
      fetchDocumentBytes(async () => {
        const res = await fetch("/api/signing/document", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" });
        if (!res.ok) throw new Error("unavailable");
        return ((await res.json()) as { url: string }).url;
      }),
    [token],
  );

  const isDone = useCallback(
    (f: FieldDef) => f.field_type === "date" || (f.field_type === "signature" || f.field_type === "initials" ? !!values[f.id]?.image : !!values[f.id]?.text?.trim()),
    [values],
  );
  const required = fields.filter((f) => f.required);
  const missing = required.filter((f) => !isDone(f));
  const doneCount = required.length - missing.length;

  const scrollTo = (f: FieldDef) => document.querySelector(`[data-field-id="${f.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  const open = (f: FieldDef) => {
    setError(null);
    if (f.field_type === "date") return;
    if (f.field_type === "signature" || f.field_type === "initials") {
      const existing = adopted[f.field_type];
      // Once a signature has been made, one tap applies it to the other signature fields.
      if (existing && !values[f.id]?.image) setValues((v) => ({ ...v, [f.id]: existing }));
      else setSigTarget(f);
      return;
    }
    setDraft(values[f.id]?.text ?? "");
    setTextTarget(f);
  };

  const finish = async () => {
    setError(null);
    if (missing.length > 0) {
      setShowMissing(true);
      setError(`${missing.length} required field${missing.length === 1 ? " is" : "s are"} still empty.`);
      scrollTo(missing[0]);
      return;
    }
    if (!consent) { setError("Please tick the box to confirm you agree to sign electronically."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/signing/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, consent: true,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          values: fields.filter((f) => f.field_type !== "date" && isDone(f)).map((f) => ({ fieldId: f.id, ...values[f.id] })),
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok: boolean; message?: string } | null;
      if (body?.ok) {
        window.location.replace(`/sign/${token}/complete`);
        return; // keep the button disabled while navigating
      }
      setError(body?.message ?? "Signing could not be completed. Please try again.");
    } catch {
      setError("We could not reach the server. Check your connection and try again; nothing has been signed yet.");
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-56 sm:pb-44">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="sign-company">{workspaceName}</p>
            <h1 className="truncate text-base font-semibold sm:text-lg" data-testid="sign-title">{title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline" data-testid="sign-progress">{doneCount} of {required.length} completed</span>
            {missing.length > 0 ? (
              <Button size="sm" variant="outline" onClick={() => scrollTo(missing[0])} data-testid="next-field"><ArrowDown /> Next field</Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-3 py-5 sm:px-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
          <span>Hello <b>{signerName}</b>. Please read the document, complete the highlighted fields, then finish at the bottom.</span>
          <form method="post" action="/api/signing/document" target="_blank">
            <input type="hidden" name="token" value={token} />
            <button className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><Download className="size-3.5" /> Download a copy</button>
          </form>
        </div>

        <PdfPages
          load={load}
          maxWidth={860}
          renderOverlay={(page) =>
            fields.filter((f) => f.page_number === page.pageNumber).map((f) => {
              const v = values[f.id];
              const done = isDone(f);
              const isSig = f.field_type === "signature" || f.field_type === "initials";
              const label = f.label || FIELD_LABEL[f.field_type];
              return (
                <button
                  key={f.id}
                  type="button"
                  data-field-id={f.id}
                  data-testid={`sign-field-${f.field_type}`}
                  data-done={done}
                  aria-label={`${label}${f.required ? " (required)" : " (optional)"}`}
                  onClick={() => open(f)}
                  disabled={f.field_type === "date"}
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%`, containerType: "size" }}
                  className={cn(
                    "absolute flex items-center overflow-hidden rounded-[3px] border-2 px-[2%] text-left transition-colors",
                    done ? "border-emerald-500/70 bg-emerald-50/40" : f.required ? "border-indigo-500 bg-indigo-100/70 hover:bg-indigo-100" : "border-dashed border-slate-400 bg-slate-100/70",
                    !done && f.required && showMissing ? "border-red-500 bg-red-100/70" : "",
                    f.field_type === "date" ? "cursor-default" : "cursor-pointer",
                  )}
                >
                  {isSig && v?.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.image} alt={`Your ${f.field_type}`} className="h-full w-full object-contain" />
                  ) : f.field_type === "date" ? (
                    <span className="flex items-center gap-[4%] whitespace-nowrap leading-none text-slate-900" style={{ fontSize: "55cqh" }}><CalendarDays className="size-[0.9em] shrink-0 text-emerald-600" />{today}</span>
                  ) : !isSig && v?.text ? (
                    <span className="whitespace-nowrap leading-none text-slate-900" style={{ fontSize: "55cqh" }}>{v.text}</span>
                  ) : (
                    <span className="flex items-center gap-1 whitespace-nowrap font-semibold leading-none text-indigo-900" style={{ fontSize: "clamp(9px, 42cqh, 14px)" }}>
                      {isSig ? <PenLine className="size-[1em] shrink-0" /> : null}
                      {isSig ? (f.field_type === "signature" ? "Sign here" : "Initial") : label}{f.required ? " *" : ""}
                    </span>
                  )}
                </button>
              );
            })
          }
        />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card shadow-[0_-4px_16px_rgba(15,23,42,0.08)]">
        <div className="mx-auto grid max-w-4xl gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="grid gap-2">
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" data-testid="consent" className="mt-0.5 size-4 shrink-0 accent-indigo-600" checked={consent} onChange={(e) => { setConsent(e.target.checked); setError(null); }} />
              <span>{consentText}</span>
            </label>
            {error ? <p className="text-sm font-medium text-red-600" role="alert" data-testid="sign-error">{error}</p> : null}
          </div>
          <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1">
            <Button size="lg" onClick={finish} disabled={submitting} data-testid="finish-signing">
              {submitting ? <Loader2 className="animate-spin" /> : <Check />} {submitting ? "Finishing…" : "Finish signing"}
            </Button>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /> {doneCount} of {required.length} required completed</span>
          </div>
        </div>
      </div>

      <SignatureDialog
        open={!!sigTarget}
        kind={sigTarget?.field_type === "initials" ? "initials" : "signature"}
        suggestedText={sigTarget?.field_type === "initials" ? signerName.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 4).toUpperCase() : signerName}
        onClose={() => setSigTarget(null)}
        onAdopt={(a) => {
          if (!sigTarget) return;
          const kind = sigTarget.field_type as "signature" | "initials";
          setAdopted((prev) => ({ ...prev, [kind]: a }));
          setValues((v) => ({ ...v, [sigTarget.id]: a }));
          setSigTarget(null);
        }}
      />

      <Dialog open={!!textTarget} onOpenChange={(o) => !o && setTextTarget(null)}>
        <DialogContent data-testid="text-dialog">
          <DialogHeader><DialogTitle>{textTarget ? textTarget.label || FIELD_LABEL[textTarget.field_type] : ""}</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!textTarget) return;
              setValues((v) => ({ ...v, [textTarget.id]: { text: draft.trim() } }));
              setTextTarget(null);
            }}
            className="grid gap-4"
          >
            <Input autoFocus value={draft} maxLength={MAX_TEXT_LENGTH} onChange={(e) => setDraft(e.target.value)} data-testid="text-input" aria-label="Field value" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTextTarget(null)}>Cancel</Button>
              <Button type="submit" data-testid="text-save">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
