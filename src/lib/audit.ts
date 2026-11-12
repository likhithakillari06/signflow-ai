import "server-only";
import type { Db } from "./db";

export const AUDIT_LABEL: Record<string, string> = {
  agreement_created: "Agreement created",
  original_uploaded: "Original PDF stored",
  fields_configured: "Signing fields saved",
  signing_link_created: "Signing link created",
  signing_link_revoked: "Signing link withdrawn",
  invitation_email_accepted: "Invitation email handed to email provider",
  invitation_email_failed: "Invitation email failed",
  invitation_email_skipped: "Invitation email not sent (email not configured)",
  agreement_viewed: "Agreement opened by signer",
  consent_accepted: "Signer consented to sign electronically",
  agreement_signed: "Agreement signed",
  completed_document_generated: "Signed PDF generated and stored",
  completion_failed: "Signed PDF could not be generated",
  agreement_cancelled: "Agreement cancelled",
  agreement_expired: "Signing link expired",
  agreement_recalled: "Agreement recalled for editing",
};

export type AuditInput = {
  workspaceId: string;
  agreementId: string;
  requestId?: string | null;
  type: keyof typeof AUDIT_LABEL | string;
  actorType: "admin" | "signer" | "system";
  actorId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Appends to the audit trail. Must be called from trusted server code with a connection that
 * is NOT running as `authenticated` (members have no insert privilege on this table).
 */
export async function recordAudit(tx: Db, e: AuditInput): Promise<void> {
  await tx`
    insert into audit_events (workspace_id, agreement_id, signing_request_id, event_type, actor_type, actor_id, metadata)
    values (${e.workspaceId}, ${e.agreementId}, ${e.requestId ?? null}, ${e.type}, ${e.actorType}, ${e.actorId ?? null},
            ${tx.json((e.metadata ?? {}) as never)})`;
}
