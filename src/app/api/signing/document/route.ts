import { NextResponse, type NextRequest } from "next/server";
import { getClientInfo } from "@/lib/env";
import { getSignerDocumentUrl } from "@/lib/services/signing";

export const dynamic = "force-dynamic";

/**
 * Signer document access. The token travels in the request body (never in a query string) and
 * only ever unlocks the document belonging to that one signing request.
 *   JSON body { token }                 -> { url }   (viewer)
 *   form body token=...&download=1      -> 303 redirect to a download URL
 */
export async function POST(request: NextRequest) {
  const client = await getClientInfo();
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    const result = await getSignerDocumentUrl(String(body?.token ?? ""), client);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  }
  const form = await request.formData().catch(() => null);
  const result = await getSignerDocumentUrl(String(form?.get("token") ?? ""), client, true);
  if ("error" in result) return new NextResponse(result.error, { status: result.status });
  return NextResponse.redirect(result.url, { status: 303, headers: { "Cache-Control": "no-store" } });
}
