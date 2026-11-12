"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";
import { emailStatusMessage } from "@/lib/email-status";
import type { EmailStatus } from "@/lib/types";

export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      data-testid="copy-link"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success("Signing link copied.");
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Could not copy automatically. Select the link and copy it manually.");
        }
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : label}
    </Button>
  );
}

/** Shown once, right after a link is created. The token is not stored, so it cannot be shown again. */
export function LinkResult({ link }: { link: { url: string; expiresAt: string; emailStatus: EmailStatus; emailError: string | null; signerEmail: string } }) {
  const msg = emailStatusMessage(link.emailStatus, link.signerEmail, link.emailError);
  return (
    <div className="grid gap-3" data-testid="link-result">
      <Alert tone={msg.tone}><span data-testid="email-status" data-status={link.emailStatus}>{msg.text}</span></Alert>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input readOnly value={link.url} data-testid="signing-link" onFocus={(e) => e.currentTarget.select()} className="h-9 min-w-0 flex-1 rounded-md border bg-secondary/50 px-3 font-mono text-xs" />
        <CopyButton value={link.url} />
      </div>
      <p className="text-xs text-muted-foreground">
        Valid until {formatDate(link.expiresAt)}. For security the link is only shown now; creating a new link later switches the old one off.
      </p>
    </div>
  );
}
