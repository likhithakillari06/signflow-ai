import Link from "next/link";
import { LayoutTemplate, Plus } from "lucide-react";
import { getContext } from "@/lib/auth";
import { listTemplates } from "@/lib/queries";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const { user, workspace } = await getContext();
  const templates = await listTemplates(user.id, workspace.id);
  return (
    <>
      <PageHeader title="Templates" description="Set up your standard agreement once. Every new file gets its own fresh copy to sign." actions={<Link href="/templates/new" className={buttonVariants()}><Plus /> New template</Link>} />
      <Card>
        {templates.length === 0 ? (
          <EmptyState icon={<LayoutTemplate />} title="No templates yet" action={<Link href="/templates/new" className={buttonVariants()}><Plus /> New template</Link>}>
            Upload the agreement every client signs and place the fields once. After that, opening a file can send it automatically.
          </EmptyState>
        ) : (
          <Table>
            <THead><tr><TH>Template</TH><TH>Pages</TH><TH>Fields</TH><TH>Used</TH><TH>Created</TH><TH /></tr></THead>
            <TBody>
              {templates.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">
                    <Link href={`/templates/${t.id}`} className="hover:underline">{t.name}</Link>
                    {workspace.default_template_id === t.id ? <Badge color="indigo" className="ml-2">Default for new files</Badge> : null}
                    {t.signature_count === 0 ? <Badge color="amber" className="ml-2">Needs a signature field</Badge> : null}
                  </TD>
                  <TD className="tabular-nums">{t.page_count}</TD>
                  <TD className="tabular-nums">{t.field_count}</TD>
                  <TD className="tabular-nums">{t.used_count}×</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDate(t.created_at)}</TD>
                  <TD className="text-right"><Link href={`/templates/${t.id}`} className="text-sm font-medium text-primary hover:underline">Edit fields</Link></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
