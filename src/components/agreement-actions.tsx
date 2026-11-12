"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Download, ExternalLink, Link2, Loader2, Mail, PencilRuler, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cancelAgreementAction, issueLinkAction, recallAgreementAction } from "@/app/(app)/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/misc";
import type { AgreementStatus } from "@/lib/status";
import type { IssuedLink } from "@/lib/services/agreements";
import { LinkResult } from "./link-result";

type Props = {
  id: string;
  status: AgreementStatus;
  signer: { name: string; email: string } | null;
  emailConfigured: boolean;
  hasLiveLink: boolean;
};

export function AgreementActions({ id, status, signer, emailConfigured, hasLiveLink }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<IssuedLink | null>(null);
  const [confirm, setConfirm] = useState<"cancel" | "recall" | null>(null);

  const issue = async (sendEmail: boolean) => {
    setBusy(sendEmail ? "email" : "link");
    const res = await issueLinkAction(id, sendEmail);
    setBusy(null);
    if (!res.ok) { toast.error(res.error); return; }
    setLink(res.data);
    router.refresh();
  };

  const run = async (kind: "cancel" | "recall") => {
    setBusy(kind);
    const res = kind === "cancel" ? await cancelAgreementAction(id) : await recallAgreementAction(id);
    setBusy(null);
    setConfirm(null);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(kind === "cancel" ? "Agreement cancelled." : "Agreement recalled. You can edit the fields again.");
    setLink(null);
    router.refresh();
  };

  const canSend = ["ready", "sent", "viewed", "expired", "failed"].includes(status);
  const again = status !== "ready";

  return (
    <div className="grid gap-3">
      {status === "draft" ? (
        <>
          <Alert tone="info">Place the signing fields to get this agreement ready to send.</Alert>
          <Link href={`/agreements/${id}/prepare`} className={buttonVariants()}><PencilRuler /> Place signing fields</Link>
        </>
      ) : null}

      {status === "signed" ? (
        <>
          <a href={`/api/agreements/${id}/document?kind=completed&download=1`} className={buttonVariants()} data-testid="download-signed"><Download /> Download signed PDF</a>
          <a href={`/api/agreements/${id}/document?kind=completed&open=1`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}><ExternalLink /> View signed PDF</a>
        </>
      ) : null}

      {canSend && signer ? (
        <>
          {link ? <LinkResult link={link} /> : null}
          {!link && hasLiveLink ? (
            <p className="text-xs text-muted-foreground">A signing link is live. Links are only shown when created; making a new one switches the old one off.</p>
          ) : null}
          <Button onClick={() => issue(false)} disabled={!!busy} variant={link ? "outline" : "default"} data-testid="create-link">
            {busy === "link" ? <Loader2 className="animate-spin" /> : <Link2 />} {again || link ? "Create new signing link" : "Create signing link"}
          </Button>
          <Button onClick={() => issue(true)} disabled={!!busy} variant="outline" data-testid="email-link" title={emailConfigured ? undefined : "Email is not configured on this deployment"}>
            {busy === "email" ? <Loader2 className="animate-spin" /> : <Mail />} {again || link ? "Send new link by email" : `Email link to ${signer.email}`}
          </Button>
          {!emailConfigured ? <p className="text-xs text-muted-foreground">Email sending is not configured here, so use “Create signing link” and share it yourself.</p> : null}
        </>
      ) : null}

      {status === "ready" ? <Link href={`/agreements/${id}/prepare`} className={buttonVariants({ variant: "ghost" })}><PencilRuler /> Edit fields or signer</Link> : null}

      {["sent", "viewed", "expired", "failed"].includes(status) ? (
        <Button variant="ghost" onClick={() => setConfirm("recall")} disabled={!!busy}><Undo2 /> Recall to edit fields</Button>
      ) : null}
      {!["signed", "cancelled"].includes(status) ? (
        <Button variant="ghost" className="text-red-700 hover:bg-red-50 hover:text-red-800" onClick={() => setConfirm("cancel")} disabled={!!busy} data-testid="cancel-agreement"><Ban /> Cancel agreement</Button>
      ) : null}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm === "cancel" ? "Cancel this agreement?" : "Recall this agreement?"}</DialogTitle>
            <DialogDescription>
              {confirm === "cancel"
                ? "The signing link stops working immediately and the agreement can no longer be signed. This cannot be undone."
                : "The current signing link stops working. You can change the fields and send a new link afterwards."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Keep as is</Button>
            <Button variant={confirm === "cancel" ? "destructive" : "default"} disabled={!!busy} onClick={() => confirm && run(confirm)} data-testid="confirm-action">
              {busy ? <Loader2 className="animate-spin" /> : null} {confirm === "cancel" ? "Cancel agreement" : "Recall"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
