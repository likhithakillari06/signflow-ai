import Link from "next/link";
import { Users } from "lucide-react";
import { getContext } from "@/lib/auth";
import { listCases, listClients, listTemplates } from "@/lib/queries";
import { CaseForm } from "@/components/forms";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";

export const metadata = { title: "New file" };

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { user, workspace } = await getContext();
  const { client } = await searchParams;
  const [clients, templates, cases] = await Promise.all([listClients(user.id, workspace.id), listTemplates(user.id, workspace.id), listCases(user.id, workspace.id)]);
  const suggested = `F-${new Date().getUTCFullYear()}-${String(cases.length + 1).padStart(3, "0")}`;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New file" description="A file is one job or case for one client." />
      <Card>
        {clients.length === 0 ? (
          <EmptyState icon={<Users />} title="Add a client first" action={<Link href="/clients/new?return=case" className={buttonVariants()}>New client</Link>}>
            A file belongs to a client.
          </EmptyState>
        ) : (
          <CardContent className="pt-5">
            <CaseForm
              clients={clients.map((c) => ({ id: c.id, name: c.name, email: c.email }))}
              templates={templates.map((t) => ({ id: t.id, name: t.name, ready: t.signature_count > 0 }))}
              defaultClientId={clients.some((c) => c.id === client) ? client : undefined}
              defaultTemplateId={templates.some((t) => t.id === workspace.default_template_id) ? workspace.default_template_id : null}
              suggestedReference={suggested}
            />
          </CardContent>
        )}
      </Card>
    </div>
  );
}
