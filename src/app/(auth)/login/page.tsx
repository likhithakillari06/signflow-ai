import { redirect } from "next/navigation";
import { FileSignature } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { configProblems } from "@/lib/health";
import { Alert } from "@/components/ui/misc";
import { AuthForm } from "./auth-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const missing = configProblems();
  if (missing.length === 0 && (await getSessionUser())) redirect("/dashboard");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><FileSignature className="size-5" /></span>
          SignFlow AI
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Welcome</h1>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">Sign in, or create a workspace for your company. Each company&apos;s clients, files and agreements are kept separate.</p>
          {missing.length > 0 ? (
            <Alert tone="error">
              This deployment is not configured yet. Missing: {missing.join(", ")}. See the README, then redeploy.
            </Alert>
          ) : (
            <AuthForm />
          )}
        </div>
      </div>
    </main>
  );
}
