import { SignMessage } from "@/components/sign-message";

const COPY: Record<string, { title: string; body: string }> = {
  invalid: { title: "This link is not valid", body: "Check that you opened the complete link from your invitation. If it still does not work, ask the sender for a new one." },
  expired: { title: "This link has expired", body: "For security, signing links only work for a limited time. Please ask the sender to send you a new link." },
  revoked: { title: "This link has been replaced", body: "The sender issued a newer link for this agreement. Please use the most recent one you received." },
  cancelled: { title: "This agreement was cancelled", body: "The sender cancelled this signing request, so there is nothing to sign. Contact them if you think this is a mistake." },
  unavailable: { title: "Not available for signing", body: "This agreement is not open for signing right now. Please contact the sender." },
  rate_limited: { title: "Too many requests", body: "Please wait a minute and reload this page." },
};

export function ClosedLink({ state, company }: { state: string; company?: string }) {
  const c = COPY[state] ?? COPY.invalid;
  return <SignMessage tone="warn" title={c.title} company={company}><p data-state={state}>{c.body}</p></SignMessage>;
}
