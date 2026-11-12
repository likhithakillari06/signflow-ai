import type { FieldType } from "./fields";
import type { AgreementStatus } from "./status";

export type Workspace = { id: string; name: string; default_template_id: string | null; link_expiry_days: number; created_at: string };
export type Client = { id: string; workspace_id: string; name: string; email: string; created_at: string };
export type CaseStatus = "intake" | "awaiting_signature" | "active" | "closed";
export type CaseRow = { id: string; workspace_id: string; client_id: string; reference: string; title: string; status: CaseStatus; created_at: string };
export type Template = { id: string; workspace_id: string; name: string; storage_path: string; page_count: number; file_size: number; sha256: string; archived_at: string | null; created_at: string };
export type Agreement = {
  id: string; workspace_id: string; case_id: string; template_id: string | null; title: string;
  original_storage_path: string; original_sha256: string; original_size: number; page_count: number;
  completed_storage_path: string | null; completed_sha256: string | null; status: AgreementStatus;
  failure_reason: string | null; created_by: string | null; created_at: string; signed_at: string | null;
};
export type Signer = { id: string; agreement_id: string; name: string; email: string };
export type FieldRow = {
  id: string; page_number: number; field_type: FieldType; x: number; y: number; width: number; height: number;
  required: boolean; label: string | null;
};
export type EmailStatus = "not_requested" | "not_configured" | "accepted" | "failed";
export type SigningRequest = {
  id: string; agreement_id: string; signer_name: string; signer_email: string; expires_at: string;
  status: "pending" | "viewed" | "completed" | "expired" | "revoked"; email_status: EmailStatus; email_error: string | null;
  email_attempted_at: string | null; first_viewed_at: string | null; consent_at: string | null;
  signer_ip: string | null; created_at: string; completed_at: string | null;
};
export type AuditEvent = {
  id: string; agreement_id: string; signing_request_id: string | null; event_type: string;
  actor_type: "admin" | "signer" | "system"; actor_id: string | null; metadata: Record<string, unknown>; created_at: string;
};

/** Columns of signing_requests that members may read (everything except token_hash). */
export const REQUEST_COLUMNS = [
  "id", "agreement_id", "signer_name", "signer_email", "expires_at", "status", "email_status", "email_error",
  "email_attempted_at", "first_viewed_at", "consent_at", "signer_ip", "created_at", "completed_at",
] as const;

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
