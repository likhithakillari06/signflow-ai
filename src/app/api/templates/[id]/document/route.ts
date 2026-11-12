import type { NextRequest } from "next/server";
import { documentResponse } from "@/lib/document-route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return documentResponse(request, "template", id);
}
