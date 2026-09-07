/**
 * Legal hold decides what retention may not delete.
 *
 * isHeld() is pure so the retention sweep can filter a whole batch without a
 * query per run — and so the scoping rules can be pinned here, where getting
 * them wrong is cheap. Getting them wrong in production means destroying
 * records under a preservation obligation, which is not recoverable.
 *
 * The asymmetry is deliberate throughout: over-preserving costs storage,
 * under-preserving costs a case. Every ambiguous input resolves to "held".
 */
import { describe, it, expect } from "vitest";
import { isHeld, type LegalHold } from "@/lib/legalHold";

const hold = (over: Partial<LegalHold> = {}): LegalHold => ({
  id: "h1", reason: "matter-9", agent_name: null, covers_from: null,
  placed_by: "legal@acme.com", placed_at: "2026-01-01T00:00:00Z",
  released_by: null, released_at: null, ...over,
});

const run = (over: Record<string, unknown> = {}) => ({
  name: "support-agent", started_at: "2026-06-01T00:00:00Z", ...over,
});

describe("isHeld", () => {
  it("holds nothing when there are no active holds", () => {
    expect(isHeld(run(), [])).toBe(false);
  });

  it("an org-wide hold covers every run", () => {
    expect(isHeld(run(), [hold()])).toBe(true);
    expect(isHeld(run({ name: "billing-agent" }), [hold()])).toBe(true);
  });

  it("an agent-scoped hold covers only that agent", () => {
    const h = [hold({ agent_name: "support-agent" })];
    expect(isHeld(run({ name: "support-agent" }), h)).toBe(true);
    expect(isHeld(run({ name: "billing-agent" }), h)).toBe(false);
  });

  it("covers_from excludes runs that started before it", () => {
    const h = [hold({ covers_from: "2026-05-01T00:00:00Z" })];
    expect(isHeld(run({ started_at: "2026-06-01T00:00:00Z" }), h)).toBe(true);
    expect(isHeld(run({ started_at: "2026-04-01T00:00:00Z" }), h)).toBe(false);
  });

  it("falls back to created_at when a run has no started_at", () => {
    const h = [hold({ covers_from: "2026-05-01T00:00:00Z" })];
    expect(isHeld({ name: "a", started_at: null, created_at: "2026-04-01T00:00:00Z" }, h)).toBe(false);
    expect(isHeld({ name: "a", started_at: null, created_at: "2026-06-01T00:00:00Z" }, h)).toBe(true);
  });

  it("holds a run with no timestamp at all rather than letting it be deleted", () => {
    const h = [hold({ covers_from: "2026-05-01T00:00:00Z" })];
    expect(isHeld({ name: "a", started_at: null, created_at: null }, h)).toBe(true);
  });

  it("any single matching hold is enough", () => {
    const holds = [hold({ agent_name: "other-agent" }), hold({ id: "h2", agent_name: "support-agent" })];
    expect(isHeld(run({ name: "support-agent" }), holds)).toBe(true);
  });
});
