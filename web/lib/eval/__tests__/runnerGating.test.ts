/**
 * Unit tests for the gating-trust rule in lib/eval/runner.ts — which items
 * count toward an eval's gating_pass_rate (and therefore a release-gate
 * decision via evalGate.ts) vs which are scored-but-excluded.
 */
import { describe, it, expect } from "vitest";
import { isTrustedForGating } from "../runner";

describe("isTrustedForGating()", () => {
  it("trusts a captured item", () => {
    expect(isTrustedForGating({ id: "1", request: {} as never, model: {} as never, scorers: [], source: "captured" })).toBe(true);
  });

  it("trusts an item from a pre-migration DB with no source field at all", () => {
    expect(isTrustedForGating({ id: "1", request: {} as never, model: {} as never, scorers: [] })).toBe(true);
  });

  it("does NOT trust a pending synthetic item", () => {
    expect(
      isTrustedForGating({ id: "1", request: {} as never, model: {} as never, scorers: [], source: "synthetic", approval_status: "pending" })
    ).toBe(false);
  });

  it("does NOT trust a rejected synthetic item", () => {
    expect(
      isTrustedForGating({ id: "1", request: {} as never, model: {} as never, scorers: [], source: "synthetic", approval_status: "rejected" })
    ).toBe(false);
  });

  it("does NOT trust a synthetic item with no approval_status at all", () => {
    expect(isTrustedForGating({ id: "1", request: {} as never, model: {} as never, scorers: [], source: "synthetic" })).toBe(false);
  });

  it("trusts an APPROVED synthetic item", () => {
    expect(
      isTrustedForGating({ id: "1", request: {} as never, model: {} as never, scorers: [], source: "synthetic", approval_status: "approved" })
    ).toBe(true);
  });
});
