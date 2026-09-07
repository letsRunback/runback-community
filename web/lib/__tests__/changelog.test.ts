import { describe, it, expect } from "vitest";
import { changelogEntries, verifyChangelogChain, type ChangelogEntry } from "@/lib/changelog";

describe("changelog hash chain", () => {
  it("verifies as published", () => {
    expect(verifyChangelogChain(changelogEntries())).toEqual({ ok: true, brokenAt: null });
  });

  it("has at least one real entry with a genesis prev_hash", () => {
    const oldest = [...changelogEntries()].sort((a, b) => a.seq - b.seq)[0];
    expect(oldest.prev_hash).toBe("");
    expect(oldest.seq).toBe(1);
  });

  it("detects a tampered entry and everything chained after it", () => {
    const entries = changelogEntries();
    const tampered: ChangelogEntry[] = entries.map((e) =>
      e.seq === 2 ? { ...e, summary: "edited after publish" } : e
    );
    const result = verifyChangelogChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it("is deterministic across calls (pure static computation)", () => {
    const a = changelogEntries();
    const b = changelogEntries();
    expect(a).toEqual(b);
  });
});
