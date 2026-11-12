import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { getContext } from "@/lib/auth";
import { listCases, listTemplates } from "@/lib/queries";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { UploadForm } from "@/components/upload-form";

export const metadata = { title: "New agreement" };

export default async function NewAgreementPage({ searchParams }: { searchParams: Promise<{ case?: string }> }) {
  const { user, workspace } = await getContext();
  const { case: caseParam } = await searchParams;
  const [cases, templates] = await Promise.all([listCases(user.id, workspace.id), listTemplates(user.id, workspace.id)]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New agreement" description="Upload any PDF, or start from a saved template. Next you will mark where the client signs." />
      <Card>
        {cases.length === 0 ? (
          <EmptyState icon={<FolderOpen />} title="Open a file first" action={<Link href="/cases/new" className={buttonVariants()}>New file</Link>}>
            Every agreement belongs to a file (a job or case for a client).
          </EmptyState>
        ) : (
          <CardContent className="pt-5">
            <UploadForm
              mode="agreement"
              cases={cases.map((c) => ({ id: c.id, reference: c.reference, title: c.title, client_name: c.client_name }))}
              templates={templates.map((t) => ({ id: t.id, name: t.name, ready: t.signature_count > 0 }))}
              defaultCaseId={cases.some((c) => c.id === caseParam) ? caseParam : undefined}
              defaultTemplateId={workspace.default_template_id}
            />
          </CardContent>
        )}
      </Card>
    </div>
  );
}
