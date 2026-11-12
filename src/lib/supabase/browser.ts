"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser client (public key only). Used solely to push large PDFs to a one-time signed upload URL. */
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!,
  );
}
