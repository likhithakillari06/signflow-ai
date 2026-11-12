import { describe, expect, it } from "vitest";
import { AGREEMENT_STATUSES, SIGNABLE_STATUSES, StatusError, assertTransition, canTransition } from "@/lib/status";
import { expiryFromNow, generateSigningToken, hashToken, isExpired, looksLikeToken } from "@/lib/tokens";

describe("signing tokens", () => {
  it("are 256-bit, URL-safe and unique", () => {
    const tokens = new Set(Array.from({ length: 500 }, generateSigningToken));
    expect(tokens.size).toBe(500);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(t, "base64url")).toHaveLength(32);
      expect(looksLikeToken(t)).toBe(true);
    }
  });
  it("are stored only as a SHA-256 hash that does not reveal the token", () => {
    const t = generateSigningToken();
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(hashToken(t)).toBe(h);
    expect(hashToken(generateSigningToken())).not.toBe(h);
  });
  it("rejects malformed tokens before touching the database", () => {
    for (const bad of ["", "short", "a".repeat(44), "a".repeat(42) + "!", null, undefined, 42, "../../etc/passwd"]) expect(looksLikeToken(bad)).toBe(false);
  });
});

describe("token expiration", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it("computes expiry from the workspace setting", () => {
    expect(expiryFromNow(14, now).toISOString()).toBe("2026-11-24T12:00:00.000Z");
  });
  it("is not expired before the deadline and is expired at or after it", () => {
    const expires = expiryFromNow(1, now);
    expect(isExpired(expires, new Date("2026-11-11T11:59:59Z"))).toBe(false);
    expect(isExpired(expires, new Date("2026-11-11T12:00:00Z"))).toBe(true);
    expect(isExpired(expires.toISOString(), new Date("2027-01-01T00:00:00Z"))).toBe(true);
  });
});

describe("agreement state transitions", () => {
  it("follows the normal path draft -> ready -> sent -> viewed -> signed", () => {
    expect(canTransition("draft", "ready")).toBe(true);
    expect(canTransition("ready", "sent")).toBe(true);
    expect(canTransition("sent", "viewed")).toBe(true);
    expect(canTransition("viewed", "signed")).toBe(true);
    expect(canTransition("sent", "signed")).toBe(true);
  });
  it("cannot skip preparation or sending", () => {
    expect(canTransition("draft", "sent")).toBe(false);
    expect(canTransition("draft", "signed")).toBe(false);
    expect(canTransition("ready", "signed")).toBe(false);
    expect(canTransition("ready", "viewed")).toBe(false);
  });
  it("treats signed and cancelled as terminal", () => {
    for (const to of AGREEMENT_STATUSES) {
      expect(canTransition("signed", to)).toBe(false);
      expect(canTransition("cancelled", to)).toBe(false);
    }
  });
  it("lets expired and failed agreements be re-sent but never signed straight from expired", () => {
    expect(canTransition("expired", "sent")).toBe(true);
    expect(canTransition("expired", "signed")).toBe(false);
    expect(canTransition("failed", "signed")).toBe(true);
    expect(canTransition("failed", "sent")).toBe(true);
  });
  it("only allows signing while sent, viewed or failed", () => {
    expect([...SIGNABLE_STATUSES].sort()).toEqual(["failed", "sent", "viewed"]);
    for (const s of AGREEMENT_STATUSES) expect(canTransition(s, "signed")).toBe(SIGNABLE_STATUSES.includes(s));
  });
  it("assertTransition throws a readable error", () => {
    expect(() => assertTransition("signed", "draft")).toThrow(StatusError);
    expect(() => assertTransition("draft", "ready")).not.toThrow();
  });
});
