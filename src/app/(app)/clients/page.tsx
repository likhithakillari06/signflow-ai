import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { getContext } from "@/lib/auth";
import { listClients } from "@/lib/queries";
import { formatDate } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const { user, workspace } = await getContext();
  const clients = await listClients(user.id, workspace.id);
  return (
    <>
      <PageHeader title="Clients" description="The people and companies you open files for." actions={<Link href="/clients/new" className={buttonVariants()}><Plus /> New client</Link>} />
      <Card>
        {clients.length === 0 ? (
          <EmptyState icon={<Users />} title="No clients yet" action={<Link href="/clients/new" className={buttonVariants()}><Plus /> New client</Link>}>
            Add a client, then open a file for them.
          </EmptyState>
        ) : (
          <Table>
            <THead><tr><TH>Name</TH><TH>Email</TH><TH>Files</TH><TH>Added</TH><TH /></tr></THead>
            <TBody>
              {clients.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD className="text-muted-foreground">{c.email}</TD>
                  <TD className="tabular-nums">{c.case_count}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDate(c.created_at)}</TD>
                  <TD className="text-right"><Link href={`/cases/new?client=${c.id}`} className="text-sm font-medium text-primary hover:underline">New file</Link></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
