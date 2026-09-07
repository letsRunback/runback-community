/**
 * Signup joins an existing org when the email domain matches, so colleagues
 * share one workspace instead of each getting an isolated org displayed under
 * the same company name.
 *
 * The two guards that make that safe are what's tested here — both fail open
 * into someone else's data if they regress:
 *
 *  1. Consumer email domains must NEVER match. Without this the first gmail.com
 *     signup owns an org that every later gmail.com user silently joins.
 *  2. The slug prefix match must not span domains. Slugs are
 *     "<slugified-domain>-<4 hex>", so a naive "acme-com-%" LIKE also matches
 *     acme.com.au's "acme-com-au-1f2e" and would put a user in a different
 *     company's workspace.
 */
import { describe, it, expect } from "vitest";
import { isPublicEmailDomain, orgSlugMatchesDomain as matches } from "@/lib/auth";

describe("join-by-domain — consumer providers are excluded", () => {
  it("rejects the big free providers", () => {
    for (const d of ["gmail.com", "outlook.com", "yahoo.com", "icloud.com", "proton.me", "qq.com"]) {
      expect(isPublicEmailDomain(d), d).toBe(true);
    }
  });

  it("rejects disposable-mail providers", () => {
    expect(isPublicEmailDomain("mailinator.com")).toBe(true);
    expect(isPublicEmailDomain("yopmail.com")).toBe(true);
  });

  it("allows ordinary company domains", () => {
    for (const d of ["accenture.com", "runback.dev", "acme.com.au"]) {
      expect(isPublicEmailDomain(d), d).toBe(false);
    }
  });

  it("is case- and whitespace-insensitive (addresses arrive unnormalised)", () => {
    expect(isPublicEmailDomain(" GMail.com ")).toBe(true);
  });
});

describe("join-by-domain — slug matching stays inside one domain", () => {
  it("matches its own org", () => {
    expect(matches("accenture.com", "accenture-com-0157")).toBe(true);
  });

  it("does not match a longer domain sharing the prefix", () => {
    // The bug a bare LIKE 'acme-com-%' would have: acme.com joining acme.com.au.
    expect(matches("acme.com", "acme-com-au-1f2e")).toBe(false);
  });

  it("does not match a different TLD on the same brand", () => {
    expect(matches("acme.com", "acme-io-1f2e")).toBe(false);
  });

  it("rejects a slug whose suffix is not the generated random one", () => {
    expect(matches("acme.com", "acme-com-notahex")).toBe(false);
    expect(matches("acme.com", "acme-com")).toBe(false);
  });
});
