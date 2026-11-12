import { redirect } from "next/navigation";
import { findWorkspace, getSessionUser } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export const metadata = { title: "Set up your workspace" };

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (await findWorkspace(user.id)) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Name your workspace</h1>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">Signed in as {user.email}. Your company&apos;s clients, files and agreements live here.</p>
        <OnboardingForm />
      </div>
    </main>
  );
}
