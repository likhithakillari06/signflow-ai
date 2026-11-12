"use client";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The page could not be loaded. If this keeps happening, check Settings → System status.
        {error.digest ? <span className="mt-1 block font-mono text-xs">Reference: {error.digest}</span> : null}
      </p>
      <Button className="mt-5" onClick={reset}>Try again</Button>
    </div>
  );
}
