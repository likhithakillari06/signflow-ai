import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getContext } from "@/lib/auth";
import { getAgreementDetail } from "@/lib/queries";
import { EDITABLE_STATUSES } from "@/lib/status";
import { FieldEditor } from "@/components/field-editor";
import { StatusBadge } from "@/components/ui/badge";

export const metadata = { title: "Place signing fields" };

export default async function PreparePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await getContext();
  const { id } = await params;
  const data = /^[0-9a-f-]{36}$/i.test(id) ? await getAgreementDetail(user.id, id) : null;
  if (!data) notFound();
  const a = data.agreement;
  if (!EDITABLE_STATUSES.includes(a.status)) redirect(`/agreements/${a.id}`);
  return (
    <>
      <div className="mb-5">
        <Link href={`/agreements/${a.id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Back to agreement</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          <StatusBadge status={a.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{a.case_reference} · {a.client_name} · {a.page_count} page{a.page_count === 1 ? "" : "s"}. Mark where the client fills in and signs.</p>
      </div>
      <FieldEditor
        mode="agreement"
        id={a.id}
        documentUrl={`/api/agreements/${a.id}/document?kind=original`}
        pageCount={a.page_count}
        initialFields={data.fields.map(({ id: _id, ...f }) => f)}
        signer={{ name: data.signer?.name ?? a.client_name, email: data.signer?.email ?? a.client_email }}
      />
    </>
  );
}
