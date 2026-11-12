import Link from "next/link";
import { CheckCircle2, Clock, FileText, FolderOpen, Plus } from "lucide-react";
import { getContext } from "@/lib/auth";
import { AUDIT_LABEL } from "@/lib/audit";
import { getDashboard } from "@/lib/queries";
import { formatDate, formatDateTime } from "@/lib/utils";
import { SampleDataButton } from "@/components/forms";
import { CaseStatusBadge, StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { user, workspace } = await getContext();
  const { counts, agreements, activity, cases } = await getDashboard(user.id, workspace.id);
  const waiting = agreements.filter((a) => ["sent", "viewed", "failed"].includes(a.status));
  const stats = [
    { label: "Total agreements", value: counts.total, icon: FileText, tone: "text-slate-600 bg-slate-100" },
    { label: "Awaiting signature", value: counts.awaiting, icon: Clock, tone: "text-amber-700 bg-amber-100" },
    { label: "Completed", value: counts.signed, icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-100" },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${workspace.name} · agreements across all files`}
        actions={<Link href="/agreements/new" className={buttonVariants()}><Plus /> New agreement</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 p-5">
              <span className={`flex size-10 items-center justify-center rounded-lg ${s.tone}`}><s.icon className="size-5" /></span>
              <div>
                <p className="text-2xl font-semibold tabular-nums" data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>{s.value}</p>
                <p className="text-sm text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {waiting.length > 0 ? (
        <Card className="mt-6 border-amber-200">
          <CardHeader><CardTitle>Waiting on clients</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {waiting.map((a) => (
              <Link key={a.id} href={`/agreements/${a.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-secondary/50">
                <span className="min-w-0"><span className="font-medium">{a.client_name}</span> <span className="text-muted-foreground">· {a.case_reference} · {a.title}</span></span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  {a.sent_at ? <>sent {formatDate(a.sent_at)}</> : null}
                  {a.expires_at ? <> · link expires {formatDate(a.expires_at)}</> : null}
                  <StatusBadge status={a.status} />
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader><CardTitle>Agreements</CardTitle></CardHeader>
        {agreements.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="No agreements yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Link href="/agreements/new" className={buttonVariants()}><Plus /> New agreement</Link>
                <SampleDataButton />
              </div>
            }
          >
            Upload any PDF agreement, mark where the client signs, and send a link. Or load sample data to look around first.
          </EmptyState>
        ) : (
          <Table data-testid="agreements-table">
            <THead><tr><TH>Agreement</TH><TH>Client</TH><TH>File</TH><TH>Status</TH><TH>Created</TH><TH className="text-right">Actions</TH></tr></THead>
            <TBody>
              {agreements.map((a) => (
                <TR key={a.id} data-agreement-id={a.id}>
                  <TD className="max-w-[18rem] truncate font-medium"><Link href={`/agreements/${a.id}`} className="hover:underline">{a.title}</Link></TD>
                  <TD>{a.client_name}</TD>
                  <TD><Link href={`/cases/${a.case_id}`} className="text-muted-foreground hover:underline">{a.case_reference}</Link></TD>
                  <TD><StatusBadge status={a.status} /></TD>
                  <TD className="whitespace-nowrap text-muted-foreground">{formatDate(a.created_at)}</TD>
                  <TD className="text-right">
                    {a.status === "signed" ? (
                      <a href={`/api/agreements/${a.id}/document?kind=completed&download=1`} className="text-sm font-medium text-primary hover:underline">Download</a>
                    ) : a.status === "draft" ? (
                      <Link href={`/agreements/${a.id}/prepare`} className="text-sm font-medium text-primary hover:underline">Place fields</Link>
                    ) : (
                      <Link href={`/agreements/${a.id}`} className="text-sm font-medium text-primary hover:underline">Open</Link>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent>
            {activity.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nothing has happened yet.</p> : (
              <ul className="grid gap-3">
                {activity.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" />
                    <span className="min-w-0">
                      <span className="font-medium">{AUDIT_LABEL[e.event_type] ?? e.event_type}</span>
                      <Link href={`/agreements/${e.agreement_id}`} className="block truncate text-muted-foreground hover:underline">{e.title}</Link>
                      <span className="text-xs text-muted-foreground">{formatDateTime(e.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent files</CardTitle></CardHeader>
          <CardContent>
            {cases.length === 0 ? (
              <EmptyState icon={<FolderOpen />} title="No files yet" action={<Link href="/cases/new" className={buttonVariants({ variant: "outline" })}>New file</Link>} />
            ) : (
              <ul className="grid gap-2">
                {cases.map((c) => (
                  <li key={c.id}>
                    <Link href={`/cases/${c.id}`} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-secondary/50">
                      <span className="min-w-0 truncate"><span className="font-medium">{c.reference}</span> <span className="text-muted-foreground">· {c.client_name}</span></span>
                      <CaseStatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
