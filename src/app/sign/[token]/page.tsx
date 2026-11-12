import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getClientInfo } from "@/lib/env";
import { openSigningSession } from "@/lib/services/signing";
import { SigningExperience } from "@/components/signing-experience";
import { ClosedLink } from "./states";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review and sign", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await openSigningSession(token, await getClientInfo());
  if (session.state === "completed") redirect(`/sign/${token}/complete`);
  if (session.state !== "open") return <ClosedLink state={session.state} company={"workspaceName" in session ? session.workspaceName : undefined} />;
  return (
    <SigningExperience
      token={token}
      workspaceName={session.workspaceName}
      title={session.title}
      signerName={session.signerName}
      fields={session.fields}
      consentText={session.consentText}
      expiresAt={session.expiresAt}
    />
  );
}
