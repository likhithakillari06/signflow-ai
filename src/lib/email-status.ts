import type { EmailStatus } from "./types";

/** Wording for an invitation's delivery state. "accepted" is never described as delivered. */
export function emailStatusMessage(status: EmailStatus, to: string, error: string | null): { tone: "success" | "warn" | "error" | "info"; text: string } {
  switch (status) {
    case "accepted":
      return { tone: "success", text: `Invitation handed to the email provider for ${to}. Delivery to the inbox is not confirmed, so keep an eye on the status here.` };
    case "failed":
      return { tone: "error", text: `The invitation email to ${to} was NOT sent${error ? `: ${error}` : "."} Copy the link and send it yourself.` };
    case "not_configured":
      return { tone: "warn", text: "No email was sent: email sending is not configured for this deployment. Copy the link and send it yourself." };
    default:
      return { tone: "info", text: "No email was sent. Copy the link and share it with the signer." };
  }
}
