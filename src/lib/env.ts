import "server-only";
import { headers } from "next/headers";

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  get supabaseUrl() {
    return read("NEXT_PUBLIC_SUPABASE_URL");
  },
  /** Public browser key. Supports both the legacy "anon" name and the newer "publishable" name. */
  get supabaseAnonKey() {
    return read("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  },
  /** Server-only key. Never imported into client code (this module is server-only). */
  get supabaseServiceKey() {
    return read("SUPABASE_SERVICE_ROLE_KEY") ?? read("SUPABASE_SECRET_KEY");
  },
  get databaseUrl() {
    return read("DATABASE_URL") ?? read("POSTGRES_URL");
  },
  get resendApiKey() {
    return read("RESEND_API_KEY");
  },
  get emailFrom() {
    return read("EMAIL_FROM") ?? "SignFlow AI <onboarding@resend.dev>";
  },
  get appUrlOverride() {
    return read("APP_URL") ?? read("NEXT_PUBLIC_APP_URL");
  },
};

export function requireEnv<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Base URL used in signing links. APP_URL wins when set; otherwise we use the host the
 * administrator is actually on, so links always point at the deployed domain.
 */
export async function getAppUrl(): Promise<string> {
  const override = env.appUrlOverride;
  if (override) return override.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) throw new Error("Cannot determine the application URL; set APP_URL.");
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto.split(",")[0]}://${host.split(",")[0].trim()}`;
}

export async function getClientInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip");
  const ua = h.get("user-agent");
  return { ip: ip || null, userAgent: ua ? ua.slice(0, 300) : null };
}
