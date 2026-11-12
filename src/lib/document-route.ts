import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "./auth";
import { getDocumentPath } from "./queries";
import { createSignedUrl, safeFileName } from "./storage";

/**
 * Shared handler for admin document access. Row Level Security decides whether the signed-in
 * user may see the row; only then is a short-lived signed URL created for that one file.
 *   default       -> { url } JSON (used by the in-app PDF viewer)
 *   ?download=1   -> redirect to a URL that downloads the file
 *   ?open=1       -> redirect to a URL that opens the file in the browser
 */
export async function documentResponse(request: NextRequest, kind: "original" | "completed" | "template", id: string) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const doc = await getDocumentPath(user.id, kind, id);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const download = request.nextUrl.searchParams.get("download") === "1";
  const open = request.nextUrl.searchParams.get("open") === "1";
  const url = await createSignedUrl(doc.path, 120, download ? safeFileName(doc.title, kind === "completed" ? "-signed" : "") : undefined);
  if (download || open) return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
}
