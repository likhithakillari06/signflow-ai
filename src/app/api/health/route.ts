import { NextResponse } from "next/server";
import { runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Deployment self-check. Reports only pass/fail per dependency; never returns secrets. */
export async function GET() {
  const checks = await runHealthChecks();
  const ok = checks.every((c) => c.ok || c.optional);
  return NextResponse.json({ ok, checks: checks.map(({ name, ok: pass, optional }) => ({ name, ok: pass, optional: !!optional })) }, { status: ok ? 200 : 503 });
}
