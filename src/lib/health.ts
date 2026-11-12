import "server-only";
import { getSql } from "./db";
import { isEmailConfigured } from "./email";
import { env } from "./env";
import { bucketExists } from "./storage";

/** Names of required settings that are missing. Empty array = good to go. */
export function configProblems(): string[] {
  const missing: string[] = [];
  if (!env.supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!env.supabaseAnonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!env.supabaseServiceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!env.databaseUrl) missing.push("DATABASE_URL");
  return missing;
}

export type HealthCheck = { name: string; ok: boolean; detail: string; optional?: boolean };

/** Live checks against the real services. Shown in Settings and at /api/health. */
export async function runHealthChecks(): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  const missing = configProblems();
  checks.push({ name: "Environment variables", ok: missing.length === 0, detail: missing.length ? `Missing: ${missing.join(", ")}` : "All required variables are set" });
  if (missing.length > 0) return checks;

  try {
    const [row] = await getSql()`select to_regclass('public.agreements') is not null as migrated, to_regclass('public.audit_events') is not null as audit`;
    checks.push({
      name: "Database",
      ok: row.migrated && row.audit,
      detail: row.migrated && row.audit ? "Connected; schema is installed" : "Connected, but the migration has not been run",
    });
  } catch (err) {
    checks.push({ name: "Database", ok: false, detail: `Cannot connect: ${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}` });
  }

  try {
    const ok = await bucketExists();
    checks.push({ name: "Private storage", ok, detail: ok ? "Bucket \"agreements\" exists and is private" : "Bucket \"agreements\" is missing or public" });
  } catch (err) {
    checks.push({ name: "Private storage", ok: false, detail: `Cannot reach storage: ${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}` });
  }

  checks.push({
    name: "Email (Resend)", optional: true, ok: isEmailConfigured(),
    detail: isEmailConfigured() ? `Configured; sending as ${env.emailFrom}` : "Not configured. Signing links can still be copied and shared manually.",
  });
  checks.push({
    name: "Link domain", optional: true, ok: true,
    detail: env.appUrlOverride ? `Signing links use ${env.appUrlOverride}` : "Signing links use the domain you are browsing on",
  });
  return checks;
}
