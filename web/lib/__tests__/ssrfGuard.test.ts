/**
 * SSRF guard.
 *
 * A red-team pass found three divergent lexical isPrivateHost copies that never
 * resolved DNS: siem's missed bracketed IPv6 (`[::1]`), and all three could be
 * bypassed by a public name resolving to an internal address, or by a redirect
 * to internal. These pin the closed form.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { isPrivateIp, isPrivateHostname, assertPublicUrl } from "@/lib/ssrfGuard";

beforeEach(() => {
  delete process.env.RUNBACK_ALLOW_PRIVATE_TARGETS;
  delete process.env.VERCEL;
});

describe("isPrivateIp", () => {
  it("blocks every private and special-use range", () => {
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1", "172.31.255.255",
      "169.254.169.254", "0.0.0.0",
      "::1", "::", "fe80::1", "fc00::1", "fd12::1", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a00:1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "140.82.121.4", "2606:4700::1111"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("172.x is only private in 16-31 (the /12), not 172.15 or 172.32", () => {
    expect(isPrivateIp("172.15.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
  });
});

describe("isPrivateHostname", () => {
  it("strips brackets — the siem gap that let [::1] through", () => {
    expect(isPrivateHostname("[::1]")).toBe(true);
    expect(isPrivateHostname("[::]")).toBe(true);
    expect(isPrivateHostname("[fe80::1]")).toBe(true);
  });

  it("blocks localhost and its subdomains", () => {
    expect(isPrivateHostname("localhost")).toBe(true);
    expect(isPrivateHostname("anything.localhost")).toBe(true);
  });

  it("lets a real hostname through to DNS", () => {
    // Not decided lexically — the DNS step is what judges it.
    expect(isPrivateHostname("hooks.slack.com")).toBe(false);
    expect(isPrivateHostname("attacker.example.com")).toBe(false);
  });
});

describe("assertPublicUrl", () => {
  it("requires HTTPS", async () => {
    await expect(assertPublicUrl("http://example.com/x")).rejects.toThrow(/HTTPS/);
  });

  it("refuses a literal private target", async () => {
    await expect(assertPublicUrl("https://169.254.169.254/latest/")).rejects.toThrow(/private|refus/i);
    await expect(assertPublicUrl("https://[::1]/x")).rejects.toThrow(/private|refus/i);
  });

  it("refuses a public NAME that resolves to a private address", async () => {
    // The core SSRF: lexically fine, but the address it names is internal.
    // nip.io maps 127-0-0-1.nip.io -> 127.0.0.1. If this ever ALLOWS, the guard
    // has regressed to lexical-only and the whole fix is undone.
    await expect(
      assertPublicUrl("https://127-0-0-1.nip.io/latest/meta-data/")
    ).rejects.toThrow(/resolves to a private/);
  });

  it("honours the self-host opt-in", async () => {
    process.env.RUNBACK_ALLOW_PRIVATE_TARGETS = "true";
    // Opted in: a private target is allowed (an in-VPC collector).
    await expect(assertPublicUrl("https://10.0.0.5/collector")).resolves.toBeInstanceOf(URL);
  });

  it("ignores the opt-in on the hosted service", async () => {
    process.env.VERCEL = "1";
    process.env.RUNBACK_ALLOW_PRIVATE_TARGETS = "true";
    // An env var copied between projects must not disable SSRF protection on prod.
    await expect(assertPublicUrl("https://10.0.0.5/collector")).rejects.toThrow(/private|refus/i);
  });
});
