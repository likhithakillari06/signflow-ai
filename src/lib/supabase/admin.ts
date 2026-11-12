import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, requireEnv } from "../env";

let cached: SupabaseClient | undefined;

/** Service-role client. Server only; used for private Storage and nothing else. */
export function getSupabaseAdmin(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      requireEnv(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv(env.supabaseServiceKey, "SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cached;
}
