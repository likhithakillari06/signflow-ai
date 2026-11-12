import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { getContext } from "@/lib/auth";
import { getCase } from "@/lib/queries";
import { formatDate } from "@/lib/utils";
import { CaseStatusBadge, StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "File" };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await getContext();
  const { id } = await params;
  const data = /^[0-9a-f-]{36}$/i.test(id) ? await getCase(user.id, id) : null;
  if (!data) notFound();
  const { case: c, agreements } = data;
  return (
    <>
      <PageHeader
        title={`${c.reference} · ${c.title}`}
        description={<span className="flex flex-wrap items-center gap-2"><CaseStatusBadge status={c.status} /> Opened {formatDate(c.created_at)}</span>}
        actions={<Link href={`/agreements/new?case=${c.id}`} className={buttonVariants()}><Plus /> Add agreement</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader><CardTitle>Agreements on this file</CardTitle></CardHeader>
          {agreements.length === 0 ? (
            <EmptyState icon={<FileText />} title="No agreement yet" action={<Link href={`/agreements/new?case=${c.id}`} className={buttonVariants()}><Plus /> Add agreement</Link>}>
              Upload the agreement for this file, or create it from a template.
            </EmptyState>
          ) : (
            <Table>
              <THead><tr><TH>Agreement</TH><TH>Status</TH><TH>Created</TH><TH>Signed</TH><TH /></tr></THead>
              <TBody>
                {agreements.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-medium"><Link href={`/agreements/${a.id}`} className="hover:underline">{a.title}</Link></TD>
                    <TD><StatusBadge status={a.status} /></TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDate(a.created_at)}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDate(a.signed_at)}</TD>
                    <TD className="text-right">
                      {a.status === "signed" ? <a href={`/api/agreements/${a.id}/document?kind=completed&download=1`} className="text-sm font-medium text-primary hover:underline">Download</a> : <Link href={`/agreements/${a.id}`} className="text-sm font-medium text-primary hover:underline">Open</Link>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader><CardTitle>Client</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <p className="font-medium">{c.client_name}</p>
            <p className="text-muted-foreground">{c.client_email}</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
