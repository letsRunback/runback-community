/**
 * Subscribe must not be usable to mail someone who did not ask, or to re-mail
 * someone who has already opted out.
 *
 * The route sent a confirmation to any address supplied, rate-limited per IP
 * only, without consulting the `unsubscribed` flag, and its sole opt-out was
 * the sentence "reply with 'unsubscribe'" — not a mechanism, since nothing
 * parses that reply. The repo's own /api/cron/newsletter already built signed
 * per-subscriber unsubscribe URLs and cited PECR/ePrivacy for doing so, and
 * /api/leads already paired an IP bucket with a per-email one; subscribe was
 * the outlier, so this is a consistency guard as much as a compliance one.
 *
 * Source-level: the failure is a side effect (an email is sent) rather than a
 * return value, and this codebase does not unit-mock Supabase builders.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(__dirname, "..", "app", "api", "newsletter", "subscribe", "route.ts"),
  "utf8"
);

describe("newsletter subscribe consent", () => {
  it("reads as the subscribe route (guard against a vacuous test)", () => {
    expect(src).toContain("newsletter_subscribers");
    expect(src.length).toBeGreaterThan(500);
  });

  it("rate-limits per email, not only per IP", () => {
    expect(src, "an IP-only limit does not stop repeated signup of one address")
      .toMatch(/rateLimit\(\s*`newsletter-email:/);
  });

  it("checks the unsubscribed flag before sending", () => {
    expect(src).toMatch(/unsubscribed/);
    // The check must gate the send, so it has to appear before the Resend call.
    expect(src.indexOf("unsubscribed")).toBeLessThan(src.indexOf("api.resend.com"));
  });

  it("includes a real unsubscribe link and the List-Unsubscribe header", () => {
    expect(src).toMatch(/signUnsubscribe\(/);
    expect(src).toMatch(/List-Unsubscribe/);
    expect(src, "reply-to-unsubscribe is not a mechanism")
      .not.toMatch(/Unsubscribe anytime — reply with "unsubscribe"\.<\/p>/);
  });
});
