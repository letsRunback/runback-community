/**
 * Every capability LICENSE names as Community must actually be reachable on
 * the free plan.
 *
 * LICENSE, LICENSING.md, README and /pricing all described the Community
 * edition as including run capture, deterministic time-travel replay, the
 * signed re-executable audit record, and evals + the release gate. The code
 * granted none of them: PLAN_FEATURES.free was empty, step_replay started at
 * pro, ledger at enterprise, and a self-host install resolves to `free`
 * because the Community Licence explicitly requires no token. The README in
 * the public repository said "nothing crippled" over three crippled headline
 * features.
 *
 * That bug is invisible at runtime — nothing errors, the capability is simply
 * absent — and it is a licence-compliance problem rather than a mere product
 * gap: the licence granted rights the software refused. This test reads the
 * licence text and checks the code honours it, so the two cannot drift again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { can, communityEvalGate } from "@/lib/entitlements";

const ROOT = join(__dirname, "..", "..", "..");
const LICENSE = join(ROOT, "LICENSE");

describe("LICENSE's Community promises are honoured by the code", () => {
  it("finds the licence file (guard against a vacuous test)", () => {
    expect(existsSync(LICENSE), "LICENSE must exist at the repo root").toBe(true);
    expect(readFileSync(LICENSE, "utf8")).toMatch(/Community edition/);
  });

  it("still describes the same four capabilities — if this fails, re-read it", () => {
    // Pinned so a licence REWORDING forces a deliberate look at the grants
    // below, rather than this file quietly checking promises no longer made.
    const text = readFileSync(LICENSE, "utf8");
    for (const phrase of [
      "run capture",
      "deterministic time-travel replay",
      "signed re-executable audit record",
      "evals + the release gate",
    ]) {
      expect(text, `LICENSE no longer says "${phrase}"`).toContain(phrase);
    }
  });

  it("grants time-travel replay on free", () => {
    expect(can("free", "step_replay")).toBe(true);
  });

  it("grants the signed audit record on free", () => {
    expect(can("free", "ledger")).toBe(true);
  });

  it("grants evals and the release gate on free", () => {
    // Via the route-level carve-out, NOT the shared `quality`/`upgrade_gate`
    // flags — granting those would also unlock Golden corpus, prompt
    // management, pairwise comparison and judge calibration.
    expect(communityEvalGate()).toBe(true);
  });

  it("does NOT over-grant: the shared flags stay paid", () => {
    // The failure mode in the other direction. If these ever become true on
    // free, four capabilities Community never promised have been given away.
    expect(can("free", "quality")).toBe(false);
    expect(can("free", "upgrade_gate")).toBe(false);
    expect(can("free", "corpus")).toBe(false);
  });

  it("keeps the Enterprise line where LICENSE draws it", () => {
    for (const f of ["sso", "compliance", "regulatory", "chargeback", "deep_replay"] as const) {
      expect(can("free", f), `${f} is Enterprise, not Community`).toBe(false);
    }
  });
});
