import { NextResponse, type NextRequest } from "next/server";
import { getAppUrl, getClientInfo } from "@/lib/env";
import { completeSigning } from "@/lib/services/signing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS: Record<string, number> = { invalid: 404, closed: 409, validation: 422, rate_limited: 429, failed: 500 };

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || typeof body.token !== "string") return NextResponse.json({ ok: false, code: "invalid", message: "This signing link is not valid." }, { status: 404 });
  const result = await completeSigning(body.token, body, await getClientInfo(), await getAppUrl());
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS[result.code] ?? 400, headers: { "Cache-Control": "no-store" } });
}
