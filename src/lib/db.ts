import "server-only";
import postgres from "postgres";
import { env, requireEnv } from "./env";

export type Db = postgres.Sql;
type Tx = postgres.TransactionSql;

const globalForDb = globalThis as unknown as { __signflowSql?: postgres.Sql };

export function getSql(): postgres.Sql {
  if (!globalForDb.__signflowSql) {
    const url = requireEnv(env.databaseUrl, "DATABASE_URL");
    const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
    globalForDb.__signflowSql = postgres(url, {
      // Supabase's transaction pooler does not support prepared statements.
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: isLocal ? false : "require",
      onnotice: () => {},
    });
  }
  return globalForDb.__signflowSql;
}

/**
 * Runs `fn` inside a transaction as the Postgres role `authenticated`, with the user's id in
 * request.jwt.claims — exactly what Supabase's API does — so Row Level Security applies to
 * everything inside. Use this for anything driven by an administrator.
 */
export async function asUser<T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  const sql = getSql();
  return (await sql.begin(async (tx: Tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`set local role authenticated`;
    return fn(tx as unknown as Db);
  })) as T;
}

/**
 * Inside an asUser transaction: temporarily drop back to the trusted connection role to do
 * something members are not allowed to do themselves (write audit events, move an agreement
 * between statuses). Only call this after an RLS-checked read has proven access.
 */
export async function elevated<T>(tx: Db, fn: () => Promise<T>): Promise<T> {
  await tx`reset role`;
  const result = await fn();
  await tx`set local role authenticated`;
  return result;
}

/** Trusted server-side transaction (bypasses RLS). Used by the signing flow and system jobs. */
export async function asSystem<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const sql = getSql();
  return (await sql.begin(async (tx: Tx) => fn(tx as unknown as Db))) as T;
}
