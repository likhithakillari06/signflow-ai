import * as React from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, CASE_STATUS_LABEL, type AgreementStatus } from "@/lib/status";

const tone: Record<string, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
};

export function Badge({ className, color = "neutral", ...props }: React.HTMLAttributes<HTMLSpanElement> & { color?: keyof typeof tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", tone[color], className)}
      {...props}
    />
  );
}

const statusTone: Record<AgreementStatus, keyof typeof tone> = {
  draft: "neutral", ready: "indigo", sent: "blue", viewed: "amber", signed: "green", expired: "neutral", cancelled: "neutral", failed: "red",
};

export function StatusBadge({ status }: { status: AgreementStatus }) {
  return (
    <Badge color={statusTone[status]} data-testid="agreement-status" data-status={status}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const caseTone: Record<string, keyof typeof tone> = { intake: "neutral", awaiting_signature: "amber", active: "green", closed: "neutral" };
export function CaseStatusBadge({ status }: { status: string }) {
  return <Badge color={caseTone[status] ?? "neutral"}>{CASE_STATUS_LABEL[status] ?? status}</Badge>;
}
