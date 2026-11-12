"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, LayoutTemplate, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createAgreementAction, createTemplateAction, prepareUploadAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { cn, formatBytes } from "@/lib/utils";

const MAX_MB = 15;
const MAX_BYTES = MAX_MB * 1024 * 1024;
/** Files up to this size go through our server; larger ones go straight to private storage. */
const DIRECT_THRESHOLD = 3.5 * 1024 * 1024;

type CaseOption = { id: string; reference: string; title: string; client_name: string };
type TemplateOption = { id: string; name: string; ready: boolean };

type Props =
  | { mode: "agreement"; cases: CaseOption[]; templates: TemplateOption[]; defaultCaseId?: string; defaultTemplateId?: string | null }
  | { mode: "template" };

export function UploadForm(props: Props) {
  const router = useRouter();
  const isAgreement = props.mode === "agreement";
  const templates = isAgreement ? props.templates : [];
  const [source, setSource] = useState<"upload" | "template">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [caseId, setCaseId] = useState(isAgreement ? props.defaultCaseId ?? props.cases[0]?.id ?? "" : "");
  const [templateId, setTemplateId] = useState(isAgreement ? props.defaultTemplateId ?? templates[0]?.id ?? "" : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileProblem = useMemo(() => {
    if (!file) return null;
    if (file.size > MAX_BYTES) return `This file is ${formatBytes(file.size)}. The limit is ${MAX_MB} MB.`;
    if (file.size === 0) return "This file is empty.";
    return null;
  }, [file]);

  const pickFile = (f: File | null) => {
    setFile(f);
    setError(null);
    if (f && !title) setTitle(f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").slice(0, 200));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const form = new FormData();
    form.set("title", title);
    if (isAgreement) form.set("caseId", caseId);

    if (isAgreement && source === "template") {
      form.set("templateId", templateId);
    } else {
      if (!file) { setError("Choose a PDF file to upload."); return; }
      if (fileProblem) { setError(fileProblem); return; }
      if (file.size > DIRECT_THRESHOLD) {
        setBusy("Uploading…");
        const slot = await prepareUploadAction(file.size);
        if (!slot.ok) { setBusy(null); setError(slot.error); return; }
        const { error: upErr } = await createSupabaseBrowser().storage.from("agreements").uploadToSignedUrl(slot.data.path, slot.data.token, new File([file], "upload.pdf", { type: "application/pdf" }), { contentType: "application/pdf" });
        if (upErr) { setBusy(null); setError(`Upload failed: ${upErr.message}`); return; }
        form.set("uploadPath", slot.data.path);
      } else {
        form.set("file", file);
      }
    }

    setBusy("Checking document…");
    const res = isAgreement ? await createAgreementAction(form) : await createTemplateAction(form);
    if (!res.ok) { setBusy(null); setError(res.error); return; }
    toast.success(isAgreement ? "Agreement created." : "Template created. Now place the signing fields.");
    if (isAgreement) {
      const status = (res.data as { status?: string }).status;
      router.push(status === "ready" ? `/agreements/${res.data.id}` : `/agreements/${res.data.id}/prepare`);
    } else {
      router.push(`/templates/${res.data.id}`);
    }
  };

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      {isAgreement ? (
        <Field label="File" htmlFor="caseId" hint="The job or case this agreement belongs to.">
          <Select id="caseId" value={caseId} onChange={(e) => setCaseId(e.target.value)} required>
            {props.cases.map((c) => (
              <option key={c.id} value={c.id}>{c.reference} — {c.title} ({c.client_name})</option>
            ))}
          </Select>
        </Field>
      ) : null}

      {isAgreement && templates.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {([["upload", "Upload a PDF", FileUp], ["template", "Use a template", LayoutTemplate]] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSource(value)}
              className={cn("flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium", source === value ? "border-primary bg-accent text-accent-foreground" : "hover:bg-secondary")}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
      ) : null}

      {isAgreement && source === "template" ? (
        <Field label="Template" htmlFor="templateId" hint="A fresh copy of the document is made for this file. Fields come from the template.">
          <Select id="templateId" value={templateId} onChange={(e) => { setTemplateId(e.target.value); if (!title) setTitle(templates.find((t) => t.id === e.target.value)?.name ?? ""); }}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.ready ? "" : " (no signature field yet)"}</option>
            ))}
          </Select>
        </Field>
      ) : (
        <div className="grid gap-1.5">
          <label htmlFor="file" className="text-sm font-medium">PDF document</label>
          <label
            htmlFor="file"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0] ?? null); }}
            className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed bg-secondary/30 px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/40"
          >
            <FileUp className="size-6 text-muted-foreground" />
            {file ? (
              <span className="text-sm font-medium" data-testid="chosen-file">{file.name} <span className="font-normal text-muted-foreground">({formatBytes(file.size)})</span></span>
            ) : (
              <span className="text-sm"><span className="font-medium text-primary">Choose a PDF</span> or drop it here</span>
            )}
            <span className="text-xs text-muted-foreground">PDF only, up to {MAX_MB} MB. Password-protected files are not supported.</span>
          </label>
          <input id="file" name="file" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          {fileProblem ? <p className="text-xs text-red-600">{fileProblem}</p> : null}
        </div>
      )}

      <Field label={isAgreement ? "Agreement title" : "Template name"} htmlFor="title" hint={isAgreement ? "Shown to the signer." : undefined}>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="Client Services Agreement" />
      </Field>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div>
        <Button type="submit" disabled={!!busy || (isAgreement && !caseId)}>
          {busy ? <><Loader2 className="animate-spin" /> {busy}</> : isAgreement ? (source === "template" ? "Create agreement" : "Upload and place fields") : "Upload and place fields"}
        </Button>
      </div>
    </form>
  );
}
