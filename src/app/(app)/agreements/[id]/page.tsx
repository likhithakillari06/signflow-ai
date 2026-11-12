import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getContext } from "@/lib/auth";
import { AUDIT_LABEL } from "@/lib/audit";
import { isEmailConfigured } from "@/lib/email";
import { FIELD_LABEL } from "@/lib/fields";
import { getAgreementDetail } from "@/lib/queries";
import { STATUS_HELP } from "@/lib/status";
import { formatBytes, formatDate, formatDateTime } from "@/lib/utils";
import { AgreementActions } from "@/components/agreement-actions";
import { emailStatusMessage } from "@/lib/email-status";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";

export const metadata = { title: "Agreement" };

const ACTOR: Record<string, string> = { admin: "Administrator", signer: "Signer", system: "System" };

function metaLine(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof meta.ip === "string") parts.push(`IP ${meta.ip}`);
  if (typeof meta.to === "string") parts.push(`to ${meta.to}`);
  if (typeof meta.signer_email === "string") parts.push(String(meta.signer_email));
  if (typeof meta.count === "number") parts.push(`${meta.count} field${meta.count === 1 ? "" : "s"}`);
  if (typeof meta.pages === "number") parts.push(`${meta.pages} page${meta.pages === 1 ? "" : "s"}`);
  if (typeof meta.sha256 === "string") parts.push(`SHA-256 ${meta.sha256.slice(0, 16)}…`);
  if (typeof meta.error === "string") parts.push(meta.error);
  if (typeof meta.reason === "string") parts.push(meta.reason);
  return parts.join(" · ");
}

export default async function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await getContext();
  const { id } = await params;
  const data = /^[0-9a-f-]{36}$/i.test(id) ? await getAgreementDetail(user.id, id) : null;
  if (!data) notFound();
  const { agreement: a, signer, fields, requests, audit } = data;
  const live = requests.find((r) => r.status === "pending" || r.status === "viewed") ?? null;
  const latest = requests[0] ?? null;
  const emailMsg = latest && latest.email_status !== "not_requested" ? emailStatusMessage(latest.email_status, latest.signer_email, latest.email_error) : null;

  return (
    <>
      <div className="mb-6">
        <Link href={`/cases/${a.case_id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> File {a.case_reference}</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          <StatusBadge status={a.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground" data-testid="status-help">{STATUS_HELP[a.status]}</p>
      </div>

      {a.status === "failed" && a.failure_reason ? <Alert tone="error" className="mb-6">Last attempt to finish signing failed: {a.failure_reason} Nothing was signed; the signer can try again with the same link.</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="grid gap-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Client</dt><dd className="font-medium">{a.client_name}</dd></div>
                <div><dt className="text-muted-foreground">File</dt><dd className="font-medium"><Link href={`/cases/${a.case_id}`} className="hover:underline">{a.case_reference} · {a.case_title}</Link></dd></div>
                <div><dt className="text-muted-foreground">Signer</dt><dd className="font-medium">{signer ? <>{signer.name} <span className="font-normal text-muted-foreground">({signer.email})</span></> : "Not set"}</dd></div>
                <div><dt className="text-muted-foreground">Created</dt><dd className="font-medium">{formatDateTime(a.created_at)}</dd></div>
                <div><dt className="text-muted-foreground">Document</dt><dd className="font-medium">{a.page_count} page{a.page_count === 1 ? "" : "s"} · {formatBytes(a.original_size)}{a.template_name ? <> · from template “{a.template_name}”</> : null}</dd></div>
                <div><dt className="text-muted-foreground">Signed</dt><dd className="font-medium">{a.signed_at ? formatDateTime(a.signed_at) : "Not yet"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">Original SHA-256</dt><dd className="break-all font-mono text-xs">{a.original_sha256}</dd></div>
                {a.completed_sha256 ? <div className="sm:col-span-2"><dt className="text-muted-foreground">Signed PDF SHA-256</dt><dd className="break-all font-mono text-xs">{a.completed_sha256}</dd></div> : null}
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-sm">
                <a href={`/api/agreements/${a.id}/document?kind=original&open=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><ExternalLink className="size-3.5" /> View original PDF</a>
                <span className="text-muted-foreground">
                  {fields.length === 0 ? "No signing fields yet" : fields.map((f) => `${FIELD_LABEL[f.field_type]} (p. ${f.page_number})`).join(", ")}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Audit trail</CardTitle></CardHeader>
            <CardContent>
              <ol className="relative grid gap-4 border-l pl-5" data-testid="audit-trail">
                {audit.map((e) => (
                  <li key={e.id} className="relative text-sm" data-event={e.event_type}>
                    <span className="absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary" />
                    <p className="font-medium">{AUDIT_LABEL[e.event_type] ?? e.event_type}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(e.created_at)} · {ACTOR[e.actor_type]}{e.actor_type === "signer" && e.actor_id ? ` (${e.actor_id})` : ""}
                      {metaLine(e.metadata) ? <> · {metaLine(e.metadata)}</> : null}
                    </p>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="grid h-fit gap-6">
          <Card>
            <CardHeader><CardTitle>{a.status === "signed" ? "Signed document" : "Send for signature"}</CardTitle></CardHeader>
            <CardContent>
              <AgreementActions id={a.id} status={a.status} signer={signer ? { name: signer.name, email: signer.email } : null} emailConfigured={isEmailConfigured()} hasLiveLink={!!live} />
            </CardContent>
          </Card>

          {latest ? (
            <Card>
              <CardHeader><CardTitle>Signing link</CardTitle></CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Link</span><Badge color={latest.status === "completed" ? "green" : live ? "blue" : "neutral"}>{latest.status === "pending" ? "live · not opened" : latest.status === "viewed" ? "live · opened" : latest.status}</Badge></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Created</span><span>{formatDate(latest.created_at)}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Expires</span><span>{formatDate(latest.expires_at)}</span></div>
                {latest.first_viewed_at ? <div className="flex items-center justify-between"><span className="text-muted-foreground">First opened</span><span>{formatDateTime(latest.first_viewed_at)}</span></div> : null}
                {emailMsg ? <Alert tone={emailMsg.tone} className="mt-1 text-xs"><span data-testid="delivery-status" data-status={latest.email_status}>{emailMsg.text}</span></Alert> : <p className="text-xs text-muted-foreground" data-testid="delivery-status" data-status="not_requested">No invitation email was requested for this link.</p>}
                {requests.length > 1 ? <p className="text-xs text-muted-foreground">{requests.length - 1} earlier link{requests.length === 2 ? "" : "s"} switched off.</p> : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
