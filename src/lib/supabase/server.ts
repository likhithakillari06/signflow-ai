import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env, requireEnv } from "../env";

/** Supabase client bound to the administrator's session cookies. Used for authentication only. */
export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    requireEnv(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv(env.supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component: cookies are refreshed by middleware instead.
          }
        },
      },
    },
  );
}
