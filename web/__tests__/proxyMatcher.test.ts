/**
 * The self-host marketing gate's matcher must exclude exactly the routes it
 * means to, and no others.
 *
 * Its alternatives used to be bare prefixes (`app`, `docs`, `spec`, `auth`, …),
 * so any future top-level route starting with those letters — /applications,
 * /authors, /specs — would silently bypass the gate. Nothing pointed that out
 * at review time because no such route existed yet; the failure would arrive
 * with an unrelated future page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "proxy.ts"), "utf8");
const m = src.match(/matcher:\s*\["([^"]+)"\]/);
const matcher = m?.[1].replace(/\\\\/g, "\\") ?? "";
const proxied = (path: string) => new RegExp(`^${matcher}$`).test(path);

describe("proxy matcher", () => {
  it("extracts the matcher (guard against a vacuous test)", () => {
    expect(matcher).toContain("_next");
    expect(matcher.length).toBeGreaterThan(50);
  });

  it("excludes the app, API and asset routes it is meant to", () => {
    for (const p of [
      "/app", "/app/runs", "/api/x", "/login", "/auth/callback", "/docs", "/docs/x",
      "/verify", "/spec", "/how-it-works", "/favicon.ico", "/robots.txt",
      "/_next/static/a.js", "/.well-known/x", "/opengraph-image",
    ]) expect(proxied(p), `${p} should bypass the gate`).toBe(false);
  });

  it("still gates ordinary marketing routes", () => {
    for (const p of ["/", "/pricing", "/blog/x", "/documentation", "/verified-claims"])
      expect(proxied(p), `${p} should be gated`).toBe(true);
  });

  it("gates routes that merely START with an excluded word", () => {
    // The actual regression this file exists for.
    for (const p of ["/applications", "/appraisals", "/authors", "/specs", "/docsite"])
      expect(proxied(p), `${p} must not bypass the gate by prefix accident`).toBe(true);
  });
});
