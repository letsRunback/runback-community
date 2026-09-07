/**
 * Scheduled-route authentication.
 *
 * These routes run retention deletion, SIEM export and billing reconciliation.
 * An attacker who authenticates as the scheduler can delete a customer's runs,
 * so the check has to fail closed and must not leak the secret through timing.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cronAuthorized } from "@/lib/cronAuth";

const req = (authorization?: string) => ({
  headers: { get: (n: string) => (n === "authorization" && authorization ? authorization : null) },
});

const ORIGINAL = process.env.CRON_SECRET;
beforeEach(() => { process.env.CRON_SECRET = "s3cr3t-value"; });
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

describe("cronAuthorized", () => {
  it("accepts the configured secret", () => {
    expect(cronAuthorized(req("Bearer s3cr3t-value"))).toBe(true);
  });

  it("rejects a wrong secret of identical length", () => {
    // Same length so the comparison cannot short-circuit on size alone.
    expect(cronAuthorized(req("Bearer s3cr3t-valuX"))).toBe(false);
  });

  it("rejects a correct prefix", () => {
    expect(cronAuthorized(req("Bearer s3cr3t"))).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(cronAuthorized(req())).toBe(false);
  });

  it("rejects the bare secret without the Bearer scheme", () => {
    expect(cronAuthorized(req("s3cr3t-value"))).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    // The dangerous inversion: an unset secret must authenticate nobody, not
    // everybody. Retention deletion runs behind this check.
    delete process.env.CRON_SECRET;
    expect(cronAuthorized(req("Bearer anything"))).toBe(false);
    expect(cronAuthorized(req("Bearer "))).toBe(false);
    expect(cronAuthorized(req())).toBe(false);
  });
});
