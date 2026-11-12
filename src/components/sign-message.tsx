import { FileSignature } from "lucide-react";

export function SignMessage({ tone = "neutral", title, children, company }: { tone?: "neutral" | "success" | "warn"; title: string; children: React.ReactNode; company?: string }) {
  const ring = tone === "success" ? "bg-emerald-100 text-emerald-700" : tone === "warn" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm" data-testid="sign-message">
        <div className={`mx-auto mb-4 flex size-12 items-center justify-center rounded-full ${ring}`}><FileSignature className="size-6" /></div>
        {company ? <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{company}</p> : null}
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="mt-2 grid gap-4 text-sm text-muted-foreground">{children}</div>
      </div>
    </main>
  );
}
