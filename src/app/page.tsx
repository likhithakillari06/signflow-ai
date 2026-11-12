import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, FileSignature } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { configProblems } from "@/lib/health";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (configProblems().length === 0 && (await getSessionUser())) redirect("/dashboard");
  const points = [
    "Open a file and the client agreement goes out by itself",
    "Works with any PDF: place the signature fields once, reuse as a template",
    "Clients sign from a secure link, no account needed",
    "Signed PDF and full audit trail stored against the file",
  ];
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <div className="mb-8 flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><FileSignature className="size-4" /></span>
        SignFlow AI
      </div>
      <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">Get the client agreement signed on every file, automatically.</h1>
      <p className="mt-4 max-w-xl text-lg text-muted-foreground">Stop chasing signatures before work can start. Upload your agreement once and every new file sends it, tracks it and stores the signed copy.</p>
      <ul className="mt-8 grid gap-3">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2.5 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />{p}</li>
        ))}
      </ul>
      <div className="mt-10">
        <Link href="/login" className="inline-flex h-11 items-center rounded-md bg-primary px-6 font-medium text-primary-foreground shadow-sm hover:bg-primary/90">Sign in or create a workspace</Link>
      </div>
    </main>
  );
}
