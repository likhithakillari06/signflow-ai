/**
 * TEST ONLY. Fixed settings for the local test stack: a throwaway Postgres (scripts/local-db.sh)
 * and the Supabase emulator in this folder. Nothing here is used by the deployed application.
 */
import { createHmac } from "node:crypto";

export const EMULATOR_PORT = Number(process.env.SIGNFLOW_EMULATOR_PORT ?? 54399);
export const APP_PORT = Number(process.env.SIGNFLOW_APP_PORT ?? 3100);
export const JWT_SECRET = "signflow-local-test-secret-not-for-production";
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/signflow_test";
export const EMULATOR_URL = `http://127.0.0.1:${EMULATOR_PORT}`;
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
export const GOOD_RESEND_KEY = "re_test_accepts_everything";

const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString("base64url");

export function signJwt(payload: Record<string, unknown>): string {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64(sig)}`;
}

export function verifyJwt(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  const expected = b64(createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest());
  if (expected !== sig) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
  if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) return null;
  return payload;
}

export const ANON_KEY = signJwt({ role: "anon", iss: "supabase-emulator", iat: 1700000000, exp: 4102444800 });
export const SERVICE_KEY = signJwt({ role: "service_role", iss: "supabase-emulator", iat: 1700000000, exp: 4102444800 });

/** Environment for the app under test. */
export function appEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: EMULATOR_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    DATABASE_URL: TEST_DATABASE_URL,
    RESEND_BASE_URL: `${EMULATOR_URL}/resend`,
    ...extra,
  };
}
