import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { getClientInfo } from "@/lib/env";
import { SIGNER_DOWNLOAD_DAYS, openSigningSession } from "@/lib/services/signing";
import { formatDateTime } from "@/lib/utils";
import { SignMessage } from "@/components/sign-message";
import { ClosedLink } from "../states";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Signed", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CompletePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await openSigningSession(token, await getClientInfo());
  if (session.state === "open") redirect(`/sign/${token}`);
  if (session.state !== "completed") return <ClosedLink state={session.state} company={"workspaceName" in session ? session.workspaceName : undefined} />;
  return (
    <SignMessage tone="success" title="You have signed this agreement" company={session.workspaceName}>
      <p data-testid="completion-status">
        <b className="text-foreground">{session.title}</b> was signed by {session.signerName} on {formatDateTime(session.completedAt)}. {session.workspaceName} has been notified.
      </p>
      {session.downloadAvailable ? (
        <form method="post" action="/api/signing/document">
          <input type="hidden" name="token" value={token} />
          <button data-testid="signer-download" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90">
            <Download className="size-4" /> Download your signed copy
          </button>
          <p className="mt-3 text-xs">Available from this link for {SIGNER_DOWNLOAD_DAYS} days after signing. You can close this page.</p>
        </form>
      ) : (
        <p>The download period for this link has ended. Please ask {session.workspaceName} for a copy.</p>
      )}
    </SignMessage>
  );
}
