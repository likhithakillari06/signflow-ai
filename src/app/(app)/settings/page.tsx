import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { getContext } from "@/lib/auth";
import { runHealthChecks } from "@/lib/health";
import { listTemplates } from "@/lib/queries";
import { SampleDataButton, SettingsForm } from "@/components/forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user, workspace } = await getContext();
  const [templates, checks] = await Promise.all([listTemplates(user.id, workspace.id), runHealthChecks()]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" description={`Workspace for ${workspace.name}. Signed in as ${user.email}.`} />
      <div className="grid gap-6">
        <Card>
          <CardHeader><CardTitle>Workspace</CardTitle></CardHeader>
          <CardContent><SettingsForm workspace={workspace} templates={templates.map((t) => ({ id: t.id, name: t.name }))} /></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>System status</CardTitle>
            <CardDescription>Live checks against this deployment&apos;s database, storage and email.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3" data-testid="system-status">
              {checks.map((c) => (
                <li key={c.name} className="flex items-start gap-3 text-sm">
                  {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : c.optional ? <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-600" />}
                  <span><span className="font-medium">{c.name}</span><span className="block text-muted-foreground">{c.detail}</span></span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sample data</CardTitle>
            <CardDescription>Adds a test client (Jordan Example), a file (MIND-TEST-001) and a clearly labelled sample agreement and template. It is demo content, not the real MIND agreement.</CardDescription>
          </CardHeader>
          <CardContent><SampleDataButton /></CardContent>
        </Card>
      </div>
    </div>
  );
}
