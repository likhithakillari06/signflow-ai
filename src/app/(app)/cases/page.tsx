import Link from "next/link";
import { FolderOpen, Plus } from "lucide-react";
import { getContext } from "@/lib/auth";
import { listCases } from "@/lib/queries";
import { formatDate } from "@/lib/utils";
import { CaseStatusBadge, StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Files" };

export default async function CasesPage() {
  const { user, workspace } = await getContext();
  const cases = await listCases(user.id, workspace.id);
  return (
    <>
      <PageHeader title="Files" description="One file per job or case. Work starts once its agreement is signed." actions={<Link href="/cases/new" className={buttonVariants()}><Plus /> New file</Link>} />
      <Card>
        {cases.length === 0 ? (
          <EmptyState icon={<FolderOpen />} title="No files yet" action={<Link href="/cases/new" className={buttonVariants()}><Plus /> New file</Link>}>
            Open a file for a client and send the agreement in the same step.
          </EmptyState>
        ) : (
          <Table>
            <THead><tr><TH>Reference</TH><TH>Title</TH><TH>Client</TH><TH>File status</TH><TH>Agreement</TH><TH>Opened</TH></tr></THead>
            <TBody>
              {cases.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium"><Link href={`/cases/${c.id}`} className="hover:underline">{c.reference}</Link></TD>
                  <TD className="max-w-[16rem] truncate">{c.title}</TD>
                  <TD>{c.client_name}</TD>
                  <TD><CaseStatusBadge status={c.status} /></TD>
                  <TD>{c.agreement_status && c.agreement_id ? <Link href={`/agreements/${c.agreement_id}`}><StatusBadge status={c.agreement_status} /></Link> : <span className="text-sm text-muted-foreground">None yet</span>}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDate(c.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
