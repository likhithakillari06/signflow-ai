"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { createCaseAction, createClientAction, loadSampleDataAction, updateSettingsAction, type CaseCreated } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert, Field } from "@/components/ui/misc";
import { LinkResult } from "./link-result";

export function ClientForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const res = await createClientAction({ name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") });
        setBusy(false);
        if (!res.ok) { setError(res.error); return; }
        toast.success("Client created.");
        router.push(returnTo === "case" ? `/cases/new?client=${res.data.id}` : "/clients");
      }}
    >
      <Field label="Client name" htmlFor="name"><Input id="name" name="name" required maxLength={160} placeholder="Jordan Example" /></Field>
      <Field label="Email" htmlFor="email" hint="Used to address the signing invitation."><Input id="email" name="email" type="email" required maxLength={254} placeholder="jordan@example.com" /></Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div><Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null} Create client</Button></div>
    </form>
  );
}

export function CaseForm({
  clients, templates, defaultClientId, defaultTemplateId, suggestedReference,
}: {
  clients: { id: string; name: string; email: string }[];
  templates: { id: string; name: string; ready: boolean }[];
  defaultClientId?: string;
  defaultTemplateId: string | null;
  suggestedReference: string;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(defaultClientId ?? clients[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(defaultTemplateId ?? "");
  const [sendNow, setSendNow] = useState(!!defaultTemplateId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CaseCreated | null>(null);
  const client = clients.find((c) => c.id === clientId);
  const template = templates.find((t) => t.id === templateId);

  if (done) {
    return (
      <div className="grid gap-4" data-testid="case-created">
        <Alert tone="success">File created.{done.link ? " The agreement was prepared from your template and a signing link is live." : ""}</Alert>
        {done.warning ? <Alert tone="warn">{done.warning}</Alert> : null}
        {done.link ? <LinkResult link={done.link} /> : null}
        <div className="flex gap-2">
          <Button onClick={() => router.push(`/cases/${done.id}`)}>Open file</Button>
          {done.agreementId ? <Button variant="outline" onClick={() => router.push(`/agreements/${done.agreementId}`)}>Open agreement</Button> : null}
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const res = await createCaseAction({
          clientId, reference: String(form.get("reference") ?? ""), title: String(form.get("title") ?? ""),
          templateId: templateId || null, sendNow: !!templateId && sendNow,
        });
        setBusy(false);
        if (!res.ok) { setError(res.error); return; }
        if (res.data.link || res.data.warning) setDone(res.data);
        else { toast.success("File created."); router.push(`/cases/${res.data.id}`); }
      }}
    >
      <Field label="Client" htmlFor="clientId">
        <Select id="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
        </Select>
        <Link href="/clients/new?return=case" className="text-xs font-medium text-primary hover:underline">+ New client</Link>
      </Field>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field label="Reference" htmlFor="reference"><Input id="reference" name="reference" required maxLength={60} defaultValue={suggestedReference} /></Field>
        <Field label="Title" htmlFor="title"><Input id="title" name="title" required maxLength={200} placeholder="What is this job or case?" /></Field>
      </div>

      <div className="rounded-lg border bg-secondary/30 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" /> Client agreement</div>
        {templates.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Save your standard agreement as a <Link href="/templates/new" className="font-medium text-primary hover:underline">template</Link> and every new file can send it automatically. For now you can add an agreement after creating the file.
          </p>
        ) : (
          <div className="mt-3 grid gap-3">
            <Field label="Agreement to send" htmlFor="templateId">
              <Select id="templateId" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setSendNow(!!e.target.value); }}>
                <option value="">None — I will add one later</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.ready ? "" : " (no signature field yet)"}</option>)}
              </Select>
            </Field>
            {templateId ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-indigo-600" checked={sendNow} disabled={!template?.ready} onChange={(e) => setSendNow(e.target.checked)} />
                <span>
                  Send for signature straight away
                  <span className="block text-xs text-muted-foreground">
                    {template?.ready ? `Creates the signing link and emails it to ${client?.email ?? "the client"} (if email is configured).` : "This template needs a required signature field first."}
                  </span>
                </span>
              </label>
            ) : null}
          </div>
        )}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      <div><Button type="submit" disabled={busy || !clientId}>{busy ? <Loader2 className="animate-spin" /> : null} {templateId && sendNow ? "Create file and send agreement" : "Create file"}</Button></div>
    </form>
  );
}

export function SettingsForm({ workspace, templates }: { workspace: { name: string; default_template_id: string | null; link_expiry_days: number }; templates: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        const res = await updateSettingsAction({
          name: String(form.get("name") ?? ""),
          defaultTemplateId: String(form.get("defaultTemplateId") ?? "") || null,
          linkExpiryDays: Number(form.get("linkExpiryDays") ?? 14),
        });
        setBusy(false);
        if (!res.ok) { setError(res.error); return; }
        toast.success("Settings saved.");
        router.refresh();
      }}
    >
      <Field label="Company name" htmlFor="name" hint="Shown to signers on the signing page and in emails."><Input id="name" name="name" required maxLength={120} defaultValue={workspace.name} /></Field>
      <Field label="Default agreement for new files" htmlFor="defaultTemplateId" hint="Pre-selected whenever you open a new file, so the agreement goes out in the same step.">
        <Select id="defaultTemplateId" name="defaultTemplateId" defaultValue={workspace.default_template_id ?? ""}>
          <option value="">None</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
      <Field label="Signing links expire after (days)" htmlFor="linkExpiryDays"><Input id="linkExpiryDays" name="linkExpiryDays" type="number" min={1} max={90} required defaultValue={workspace.link_expiry_days} className="w-32" /></Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div><Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null} Save settings</Button></div>
    </form>
  );
}

export function SampleDataButton({ variant = "outline" }: { variant?: "outline" | "default" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      disabled={busy}
      data-testid="load-sample"
      onClick={async () => {
        setBusy(true);
        const res = await loadSampleDataAction();
        setBusy(false);
        if (!res.ok) { toast.error(res.error); return; }
        toast.success("Sample data loaded: client Jordan Example, file MIND-TEST-001 and a sample agreement.");
        router.push(`/agreements/${res.data.agreementId}`);
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Load sample data
    </Button>
  );
}
