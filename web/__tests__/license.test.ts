import { describe, it, expect } from "vitest";
import { verifyLicense } from "../lib/license";

// The moats are gated on a Valid License. These prove the cryptographic floor:
// without Runback's private key, no token verifies — so nothing can be activated
// by guessing, faking, or tampering. (A real Ed25519-signed token can't be tested
// here because that would require the private key — which is the whole point.)
describe("license verification — no fake license can activate the moats", () => {
  it("rejects empty / missing / arbitrary tokens", () => {
    expect(verifyLicense(null)).toBeNull();
    expect(verifyLicense(undefined)).toBeNull();
    expect(verifyLicense("")).toBeNull();
    expect(verifyLicense("enterprise")).toBeNull(); // the classic guess
    expect(verifyLicense("not.a.real.token")).toBeNull();
  });

  it("rejects a well-formed payload with a forged/garbage signature", () => {
    const payload = Buffer.from(JSON.stringify({ iss: "runback", plan: "enterprise", exp: 9999999999 })).toString("base64url");
    const garbageSig = Buffer.from(new Uint8Array(64)).toString("base64url"); // 64 zero bytes
    expect(verifyLicense(`${payload}.${garbageSig}`)).toBeNull();
    const randomSig = Buffer.from("x".repeat(64)).toString("base64url");
    expect(verifyLicense(`${payload}.${randomSig}`)).toBeNull();
  });

  it("rejects a payload with the wrong issuer even if otherwise shaped right", () => {
    const payload = Buffer.from(JSON.stringify({ iss: "attacker", plan: "enterprise" })).toString("base64url");
    const sig = Buffer.from(new Uint8Array(64)).toString("base64url");
    expect(verifyLicense(`${payload}.${sig}`)).toBeNull();
  });
});
