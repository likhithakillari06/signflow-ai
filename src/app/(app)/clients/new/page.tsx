import { ClientForm } from "@/components/forms";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";

export const metadata = { title: "New client" };

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ return?: string }> }) {
  const { return: returnTo } = await searchParams;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="New client" description="Use test data only for this assessment environment." />
      <Card><CardContent className="pt-5"><ClientForm returnTo={returnTo} /></CardContent></Card>
    </div>
  );
}
