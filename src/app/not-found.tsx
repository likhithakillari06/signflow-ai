import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">It may have been moved, or you may not have access to it.</p>
      <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">Back to dashboard</Link>
    </main>
  );
}
