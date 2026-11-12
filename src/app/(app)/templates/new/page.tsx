import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { UploadForm } from "@/components/upload-form";

export const metadata = { title: "New template" };

export default function NewTemplatePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New template" description="Upload the blank agreement. The template stores the document and the field positions only, never anyone's signature." />
      <Card><CardContent className="pt-5"><UploadForm mode="template" /></CardContent></Card>
    </div>
  );
}
