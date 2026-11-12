import { createHash, randomBytes } from "node:crypto";

/** 256 bits from the OS CSPRNG, URL-safe. Only its SHA-256 hash is ever stored. */
export function generateSigningToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function looksLikeToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function expiryFromNow(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isExpired(expiresAt: Date | string, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
