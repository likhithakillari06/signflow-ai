export const AGREEMENT_STATUSES = ["draft", "ready", "sent", "viewed", "signed", "expired", "cancelled", "failed"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const STATUS_LABEL: Record<AgreementStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  sent: "Sent",
  viewed: "Viewed",
  signed: "Signed",
  expired: "Expired",
  cancelled: "Cancelled",
  failed: "Failed",
};

export const STATUS_HELP: Record<AgreementStatus, string> = {
  draft: "Signing fields still need to be placed.",
  ready: "Prepared. Create a signing link to send it.",
  sent: "Waiting for the signer to open the link.",
  viewed: "The signer has opened the agreement but not signed yet.",
  signed: "Signed. The completed PDF is stored.",
  expired: "The signing link expired before it was signed.",
  cancelled: "Cancelled. It can no longer be signed.",
  failed: "The signed PDF could not be generated. The signer can try again.",
};

/**
 * Allowed moves. `signed` and `cancelled` are terminal (also enforced by a database trigger).
 *  - sent/viewed -> sent : link rotated or invitation re-sent
 *  - sent/viewed/expired/failed -> ready : link recalled so the fields can be edited
 */
const TRANSITIONS: Record<AgreementStatus, readonly AgreementStatus[]> = {
  draft: ["ready", "cancelled"],
  ready: ["draft", "sent", "cancelled"],
  sent: ["sent", "viewed", "signed", "expired", "failed", "ready", "cancelled"],
  viewed: ["sent", "signed", "expired", "failed", "ready", "cancelled"],
  expired: ["sent", "ready", "cancelled"],
  failed: ["sent", "viewed", "signed", "expired", "ready", "cancelled"],
  signed: [],
  cancelled: [],
};

export function canTransition(from: AgreementStatus, to: AgreementStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AgreementStatus, to: AgreementStatus): void {
  if (!canTransition(from, to)) {
    throw new StatusError(`An agreement that is ${STATUS_LABEL[from].toLowerCase()} cannot become ${STATUS_LABEL[to].toLowerCase()}.`);
  }
}

export class StatusError extends Error {}

/** Statuses in which a signer holding a valid link may still sign. */
export const SIGNABLE_STATUSES: readonly AgreementStatus[] = ["sent", "viewed", "failed"];
/** Statuses that count as "waiting on the client". */
export const PENDING_STATUSES: readonly AgreementStatus[] = ["sent", "viewed", "failed"];
/** Statuses in which the field layout can still be edited. */
export const EDITABLE_STATUSES: readonly AgreementStatus[] = ["draft", "ready"];

export const CASE_STATUS_LABEL: Record<string, string> = {
  intake: "Intake",
  awaiting_signature: "Awaiting signature",
  active: "Cleared to start",
  closed: "Closed",
};
