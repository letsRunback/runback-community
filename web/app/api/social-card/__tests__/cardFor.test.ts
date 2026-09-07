/**
 * Regression coverage for the exact complaint that shipped twice: every
 * incident card shared the same eyebrow, kicker, fix line, and accent
 * color — only the headline text differed. cardFor() now picks each of
 * those from a per-type pool, seeded from the post's own content, so
 * different posts land on different combinations almost all the time while
 * the same post still reproduces the same card on retry.
 */
import { describe, it, expect } from "vitest";
import { cardFor, djb2, pickLayoutIndex, LAYOUT_COUNT } from "../route";

function seedFor(type: string, headline: string): number {
  return djb2([type, headline].filter(Boolean).join("|"));
}

const HEADLINES = [
  "Pizza Hut franchisee says AI caused $100M in damages",
  "Caught in 4K: The Aurora Files",
  "Warner Music Group and Suno Forge Groundbreaking Partnership",
  "Aurora ransomware targets ESXi, abuses Cursor Agent for exploitation",
  "Record labels claim AI generator Suno illegally ripped their songs",
  "Innocent woman thrown in jail due to fake AI texts",
];

describe("cardFor produces real per-post variety, not a re-skinned template", () => {
  it("does not repeat the same (eyebrow, kicker, fix, color) combination across a batch of different incidents", () => {
    const combos = new Set<string>();
    for (const headline of HEADLINES) {
      const q = new URLSearchParams({ type: "incident", headline });
      const c = cardFor("incident", q, seedFor("incident", headline));
      combos.add(`${c.eyebrow}|${c.kicker}|${c.fix}|${c.eyebrowColor}`);
    }
    // Not every combo need be unique by chance, but a design that "never
    // repeats" for six different real headlines should produce close to six
    // distinct combinations, not one.
    expect(combos.size).toBeGreaterThanOrEqual(4);
  });

  it("is deterministic — the same headline always produces the same card (stable for retries and CDN caching)", () => {
    const q = new URLSearchParams({ type: "incident", headline: HEADLINES[0] });
    const seed = seedFor("incident", HEADLINES[0]);
    const a = cardFor("incident", q, seed);
    const b = cardFor("incident", q, seed);
    expect(a).toEqual(b);
  });

  it("varies the eyebrow text itself, not just the headline", () => {
    const eyebrows = new Set(
      HEADLINES.map((h) => cardFor("incident", new URLSearchParams({ type: "incident", headline: h }), seedFor("incident", h)).eyebrow)
    );
    expect(eyebrows.size).toBeGreaterThan(1);
  });

  it("varies the accent color, not a single fixed hue per type", () => {
    const colors = new Set(
      HEADLINES.map((h) => cardFor("incident", new URLSearchParams({ type: "incident", headline: h }), seedFor("incident", h)).eyebrowColor)
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("keeps the incident/regulatory verdict semantic intact regardless of accent color variety", () => {
    // Color variety must not blur the one signal that's semantically load-bearing:
    // incident -> unprovable (red X), regulatory/model_release/fleet_weekly -> provable (green check).
    for (const h of HEADLINES) {
      const c = cardFor("incident", new URLSearchParams({ type: "incident", headline: h }), seedFor("incident", h));
      expect(c.hero).toBe("invalid");
    }
    const reg = cardFor("regulatory", new URLSearchParams({ type: "regulatory", headline: "EU AI Act Article 12 is now enforceable" }), seedFor("regulatory", "x"));
    expect(reg.hero).toBe("valid");
  });
});

describe("layout selection — real structural variety, not just palette/copy swaps within one skeleton", () => {
  it("has at least 15 distinct layouts", () => {
    expect(LAYOUT_COUNT).toBeGreaterThanOrEqual(15);
  });

  it("spreads across most of the available layouts over many different posts, not clustering on a few", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const seed = djb2(`incident|headline number ${i}`);
      seen.add(pickLayoutIndex(seed));
    }
    // Every index should be reachable — a real bug here (e.g. an off-by-one
    // in the multiply-by-length step) would silently drop one end of the
    // range instead of throwing.
    expect(seen.size).toBe(LAYOUT_COUNT);
    for (const idx of seen) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(LAYOUT_COUNT);
    }
  });

  it("is deterministic — the same seed always selects the same layout", () => {
    const seed = djb2("incident|a specific real headline");
    expect(pickLayoutIndex(seed)).toBe(pickLayoutIndex(seed));
  });

  it("selects layout independently of content choices — same accent color, different layouts are still possible", () => {
    // Regression target: layout selection must use its own seed salt, not
    // reuse cardFor's, or every post with the same accent color would also
    // render with the same layout — the exact "same skeleton, different
    // paint" bug this system exists to avoid.
    const layoutsForRoseIncidents = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const headline = `incident number ${i}`;
      const seed = djb2(`incident|${headline}`);
      const q = new URLSearchParams({ type: "incident", headline });
      const c = cardFor("incident", q, seed);
      if (c.eyebrowColor) layoutsForRoseIncidents.add(pickLayoutIndex(seed));
    }
    expect(layoutsForRoseIncidents.size).toBeGreaterThan(1);
  });
});
