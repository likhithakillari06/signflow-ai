import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getContext } from "@/lib/auth";
import { getTemplate } from "@/lib/queries";
import { FieldEditor } from "@/components/field-editor";

export const metadata = { title: "Template" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await getContext();
  const { id } = await params;
  const data = /^[0-9a-f-]{36}$/i.test(id) ? await getTemplate(user.id, id) : null;
  if (!data) notFound();
  const t = data.template;
  return (
    <>
      <div className="mb-5">
        <Link href="/templates" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Templates</Link>
        <h1 className="text-2xl font-semibold">{t.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.page_count} page{t.page_count === 1 ? "" : "s"}. Changes apply to agreements created from now on; agreements already created keep their own copy.</p>
      </div>
      <FieldEditor mode="template" id={t.id} documentUrl={`/api/templates/${t.id}/document`} pageCount={t.page_count} initialFields={data.fields.map(({ id: _id, ...f }) => f)} />
    </>
  );
}
