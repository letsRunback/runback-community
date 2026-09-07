/**
 * Unit tests for the security-critical functions in lib/sso.ts:
 *
 *   encryptSsoSecret / decryptSsoSecret  — AES-256-GCM at-rest encryption
 *   assertSafeIssuer                     — SSRF prevention for OIDC issuer URLs
 *
 * These are pure / crypto functions; no DB or network calls involved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { encryptSsoSecret, decryptSsoSecret, assertSafeIssuer } from "../sso";

// Block the jose / supabase imports so the module loads cleanly without real infra.
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({}));

const TEST_KEY = "test-sso-secret-key-for-unit-tests-only";

// ─── encryptSsoSecret / decryptSsoSecret ─────────────────────────────────────

describe("encryptSsoSecret() + decryptSsoSecret()", () => {
  beforeEach(() => {
    vi.stubEnv("SSO_SECRET_KEY", TEST_KEY);
  });

  it("roundtrip: decrypt(encrypt(s)) === s", () => {
    const plain = "super-secret-client-secret-from-okta";
    expect(decryptSsoSecret(encryptSsoSecret(plain))).toBe(plain);
  });

  it("ciphertext starts with enc:v1: prefix", () => {
    expect(encryptSsoSecret("abc")).toMatch(/^enc:v1:/);
  });

  it("ciphertext has exactly 4 colon-separated parts (enc:v1:<iv>:<tag>:<ct>)", () => {
    const parts = encryptSsoSecret("abc").split(":");
    // "enc", "v1", iv_hex, tag_hex, ct_hex  → but ct can be empty string → 5 parts
    // Actually: "enc:v1:<iv_hex>:<tag_hex>:<ct_hex>" — 5 colon-separated parts total
    expect(parts.length).toBe(5);
    expect(parts[0]).toBe("enc");
    expect(parts[1]).toBe("v1");
    expect(parts[2]).toMatch(/^[0-9a-f]{24}$/); // 12-byte IV = 24 hex chars
    expect(parts[3]).toMatch(/^[0-9a-f]{32}$/); // 16-byte auth tag = 32 hex chars
  });

  it("produces different ciphertexts each call (random IV)", () => {
    const ct1 = encryptSsoSecret("same");
    const ct2 = encryptSsoSecret("same");
    expect(ct1).not.toBe(ct2);
  });

  it("roundtrip works for empty string", () => {
    expect(decryptSsoSecret(encryptSsoSecret(""))).toBe("");
  });

  it("roundtrip works for unicode / multi-byte content", () => {
    const val = "клиент-секрет-🔑";
    expect(decryptSsoSecret(encryptSsoSecret(val))).toBe(val);
  });

  it("legacy plaintext (no enc:v1: prefix) passes through decrypt unchanged", () => {
    expect(decryptSsoSecret("old-plaintext-secret")).toBe("old-plaintext-secret");
  });

  it("empty string passes through decrypt unchanged", () => {
    expect(decryptSsoSecret("")).toBe("");
  });

  it("malformed enc:v1: ciphertext (wrong part count) throws", () => {
    expect(() => decryptSsoSecret("enc:v1:onlytwoparts")).toThrow();
  });

  it("wrong decryption key causes auth-tag mismatch (throws)", () => {
    const ct = encryptSsoSecret("secret");
    vi.stubEnv("SSO_SECRET_KEY", "completely-different-key-xxxxxxxxxx");
    expect(() => decryptSsoSecret(ct)).toThrow();
  });

  describe("no SSO_SECRET_KEY set (dev mode)", () => {
    beforeEach(() => {
      vi.stubEnv("SSO_SECRET_KEY", "");
      vi.stubEnv("NODE_ENV", "test"); // ensure we're not in "production" branch
    });

    it("encryptSsoSecret returns plaintext (dev fallback)", () => {
      const plain = "dev-secret";
      expect(encryptSsoSecret(plain)).toBe(plain);
    });

    it("decryptSsoSecret on plaintext still passes through", () => {
      expect(decryptSsoSecret("dev-secret")).toBe("dev-secret");
    });
  });
});

// ─── assertSafeIssuer() ───────────────────────────────────────────────────────

describe("assertSafeIssuer()", () => {
  describe("valid public HTTPS URLs — must NOT throw", () => {
    it.each([
      "https://accounts.google.com",
      "https://login.microsoftonline.com/tenant-id/v2.0",
      "https://dev-123456.okta.com",
      "https://auth0.example.com",
      "https://ping.example.com/oauth",
    ])("%s", (url) => {
      expect(() => assertSafeIssuer(url)).not.toThrow();
    });
  });

  describe("non-HTTPS URLs — must throw", () => {
    it.each([
      "http://accounts.google.com",
      "http://legitimate-looking.com",
      "ftp://example.com",
    ])("%s", (url) => {
      expect(() => assertSafeIssuer(url)).toThrow();
    });
  });

  describe("RFC-1918 / loopback / link-local — must throw (SSRF)", () => {
    it.each([
      "https://localhost/oidc",
      "https://127.0.0.1/.well-known/openid-configuration",
      "https://127.255.255.255/oidc",
      "https://10.0.0.1/oidc",
      "https://10.255.255.255/oidc",
      "https://192.168.0.1/oidc",
      "https://192.168.255.255/oidc",
      "https://172.16.0.1/oidc",
      "https://172.20.0.1/oidc",
      "https://172.31.255.255/oidc",
      "https://169.254.169.254/latest/meta-data",  // AWS metadata
      "https://169.254.0.1/oidc",
    ])("%s", (url) => {
      expect(() => assertSafeIssuer(url)).toThrow();
    });
  });

  describe("RFC-1918 boundary — must NOT throw (just outside range)", () => {
    it.each([
      "https://172.15.0.1/oidc",  // 172.15.x — just below 172.16.x range
      "https://172.32.0.1/oidc",  // 172.32.x — just above 172.31.x range
      "https://11.0.0.1/oidc",    // not RFC-1918 (10.x is, but 11.x is not)
    ])("%s", (url) => {
      expect(() => assertSafeIssuer(url)).not.toThrow();
    });
  });

  describe("IPv6 private / loopback — must throw (SSRF)", () => {
    it.each([
      "https://[::1]/.well-known/openid-configuration",
      "https://[::ffff:127.0.0.1]/oidc",
      "https://[::ffff:10.0.0.1]/oidc",
      "https://[::ffff:169.254.169.254]/oidc",
      "https://[::ffff:7f00:1]/oidc",
      "https://[fd00::1]/oidc",
      "https://[fe80::1]/oidc",
    ])("%s", (url) => {
      expect(() => assertSafeIssuer(url)).toThrow();
    });
  });

  describe("IPv6 public — must NOT throw", () => {
    it.each([
      "https://[2001:db8::1]/oidc",
      "https://[2606:4700::1]/oidc",
    ])("%s", (url) => {
      expect(() => assertSafeIssuer(url)).not.toThrow();
    });
  });

  it("invalid URL throws", () => {
    expect(() => assertSafeIssuer("not-a-url")).toThrow();
    expect(() => assertSafeIssuer("")).toThrow();
  });
});
