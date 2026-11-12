import "server-only";
import { getSql } from "./db";

/** Fixed-window limiter backed by Postgres, so it works across serverless instances. */
export async function withinRateLimit(key: string, max: number, windowSeconds = 60): Promise<boolean> {
  try {
    const [row] = await getSql()`select public.hit_rate_limit(${key}, ${windowSeconds}, ${max}) as ok`;
    return row.ok === true;
  } catch {
    // If the limiter itself is unavailable, do not lock signers out.
    return true;
  }
}
