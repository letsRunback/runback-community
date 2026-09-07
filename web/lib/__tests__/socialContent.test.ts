/**
 * Social posts and their cards.
 *
 * generatePost() tries a model call first (real structural variety, grounded
 * in the signal's own facts) and falls back to a deterministic template if no
 * model key is configured, the call fails, or the draft fails validation.
 * These tests mock the model layer so they run offline and deterministically;
 * generateFallbackPost's own tests pin the reliability floor directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SocialSignal, Platform } from "@/lib/socialContent";

const generateTextMock = vi.fn();
vi.mock("ai", () => ({ generateText: (...args: unknown[]) => generateTextMock(...args) }));

const resolveModelMock = vi.fn();
vi.mock("@/lib/replay/runStep", () => ({ resolveModel: (...args: unknown[]) => resolveModelMock(...args) }));

vi.mock("@/lib/eval/judge", () => ({ pickJudgeModel: () => "claude-haiku-4-5-20251001" }));

const {
  generatePost,
  generateFallbackPost,
  imageForSignal,
  pickHashtags,
  violatesBannedPhrase,
  hasInventedNumber,
} = await import("@/lib/socialContent");

const SIGNALS: SocialSignal[] = [
  { type: "regulatory", title: "EU AI Act Article 12 is now enforceable", summary: "High-risk AI systems must keep automatic, traceable logs." },
  { type: "model_release", title: "Claude Opus 5 released", metadata: { model: "Claude Opus 5" } },
  { type: "incident", title: "Another agent shipped a wrong refund", summary: "A support agent auto-approved a disputed charge." },
  { type: "fleet_weekly", title: "weekly", metadata: { run_count: 12400, top_cause: "policy deviation" } },
];

const LIMIT: Record<Platform, number> = { twitter: 280, bluesky: 300, linkedin: 1300 };

beforeEach(() => {
  generateTextMock.mockReset();
  resolveModelMock.mockReset();
});

describe("generatePost falls back to templates when no model is available", () => {
  it("falls back when resolveModel throws (no key configured)", async () => {
    resolveModelMock.mockImplementation(() => { throw new Error("no key"); });
    const post = await generatePost(SIGNALS[0], "linkedin");
    expect(post).toEqual(generateFallbackPost(SIGNALS[0], "linkedin"));
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("falls back when the model call throws", async () => {
    resolveModelMock.mockReturnValue({});
    generateTextMock.mockRejectedValue(new Error("network"));
    const post = await generatePost(SIGNALS[1], "twitter");
    expect(post).toEqual(generateFallbackPost(SIGNALS[1], "twitter"));
  });

  it("falls back when every attempt contains a banned phrase", async () => {
    resolveModelMock.mockReturnValue({});
    generateTextMock.mockResolvedValue({ text: "Here's the catch: this is generic AI slop. https://runback.dev" });
    const post = await generatePost(SIGNALS[2], "linkedin");
    expect(post).toEqual(generateFallbackPost(SIGNALS[2], "linkedin"));
    expect(generateTextMock).toHaveBeenCalledTimes(2); // one retry, both bad
  });

  it("falls back when the model invents a number not in the signal", async () => {
    resolveModelMock.mockReturnValue({});
    generateTextMock.mockResolvedValue({ text: "94% of teams get this wrong. https://runback.dev" });
    const post = await generatePost(SIGNALS[2], "linkedin");
    expect(post).toEqual(generateFallbackPost(SIGNALS[2], "linkedin"));
  });

  it("falls back when the draft omits the link entirely", async () => {
    resolveModelMock.mockReturnValue({});
    generateTextMock.mockResolvedValue({ text: "A post with no link in it at all, just words." });
    const post = await generatePost(SIGNALS[0], "linkedin");
    expect(post).toEqual(generateFallbackPost(SIGNALS[0], "linkedin"));
  });
});

describe("generatePost accepts a clean model draft", () => {
  it("uses the model's text when it passes validation", async () => {
    resolveModelMock.mockReturnValue({});
    generateTextMock.mockResolvedValue({
      text: "A support agent just auto-approved a refund nobody reviewed. That's the whole risk in one sentence. https://runback.dev/how-it-works",
    });
    const post = await generatePost(SIGNALS[2], "linkedin");
    expect(post).toContain("auto-approved a refund");
    expect(post).toContain("runback.dev");
  });

  it("clips an overlong model draft to the platform limit", async () => {
    resolveModelMock.mockReturnValue({});
    generateTextMock.mockResolvedValue({ text: "x".repeat(500) + " https://runback.dev" });
    const post = await generatePost(SIGNALS[3], "twitter");
    expect(post.length).toBeLessThanOrEqual(LIMIT.twitter);
  });

  it("never truncates mid-link when clipping an overlong draft (a broken link is worse than a shorter post)", async () => {
    resolveModelMock.mockReturnValue({});
    // The link lands near the very end of a too-long draft — a naive
    // end-clip would cut it off mid-URL.
    const filler = "This is filler text about the incident that goes on for a while. ".repeat(6);
    generateTextMock.mockResolvedValue({ text: `${filler}https://runback.dev/how-it-works` });
    const post = await generatePost(SIGNALS[2], "twitter");
    expect(post.length).toBeLessThanOrEqual(LIMIT.twitter);
    expect(post).toContain("https://runback.dev/how-it-works");
  });
});

describe("the deterministic fallback (reliability floor)", () => {
  it("never exceeds the platform character limit", () => {
    for (const s of SIGNALS) {
      for (const p of ["twitter", "bluesky", "linkedin"] as Platform[]) {
        const post = generateFallbackPost(s, p);
        expect(post.length, `${s.type}/${p}`).toBeLessThanOrEqual(LIMIT[p]);
        expect(post.length, `${s.type}/${p} empty`).toBeGreaterThan(20);
      }
    }
  });

  it("leads with the reader's problem and names the fix", () => {
    const li = generateFallbackPost(SIGNALS[0], "linkedin");
    expect(li).toMatch(/Runback/);
    expect(li).toMatch(/runback\.dev/);
  });

  it("drops the internal jargon from the hooks", () => {
    for (const s of SIGNALS) {
      const hook = generateFallbackPost(s, "twitter").split("\n")[0].toLowerCase();
      expect(hook, `${s.type} hook`).not.toMatch(/cassette|oracle|non-deterministic/);
    }
  });
});

describe("banned-phrase and grounding checks", () => {
  it("flags a banned phrase case-insensitively", () => {
    expect(violatesBannedPhrase("Here's The Catch: something")).toBe("here's the catch");
    expect(violatesBannedPhrase("a perfectly normal sentence")).toBeNull();
  });

  it("flags a fabricated first-person anecdote", () => {
    // None of the signal types carry a personal story — a model reaching for
    // "concreteness" by inventing "I've been there" is fabricating an
    // experience, which is exactly the kind of claim this product argues
    // against making anywhere else on the site.
    expect(violatesBannedPhrase("I've been there. We missed it until the customer called.")).toBe("i've been there");
    expect(violatesBannedPhrase("This happened to us last quarter.")).toBe("happened to us");
  });

  it("flags a number with no basis in the signal", () => {
    const s: SocialSignal = { type: "incident", title: "An agent misfired" };
    expect(hasInventedNumber("costing teams 47% more", s)).toBe(true);
    expect(hasInventedNumber("no numbers here", s)).toBe(false);
  });

  it("does not flag a number that traces back to the signal's own metadata", () => {
    const s: SocialSignal = { type: "fleet_weekly", title: "weekly", metadata: { run_count: 12400 } };
    expect(hasInventedNumber("12,400 runs sealed this week", s)).toBe(false);
  });
});

describe("hashtags are not a fixed static block", () => {
  it("produces a mix of zero, one, and two tags across many calls", () => {
    const counts = new Set<number>();
    for (let i = 0; i < 40; i++) counts.add(pickHashtags("regulatory").length);
    expect(counts.size).toBeGreaterThan(1); // real variety, not always the same count
    for (let i = 0; i < 40; i++) {
      const tags = pickHashtags("regulatory");
      expect(tags.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("every post ships a purpose-built card", () => {
  it("uses the dynamic card route, not a static screenshot", () => {
    for (const s of SIGNALS) {
      const url = imageForSignal(s);
      expect(url, s.type).toContain("/api/social-card");
      expect(url, `${s.type} not a screenshot`).not.toMatch(/\.png$/);
      expect(url).toContain(`type=${s.type}`);
    }
  });

  it("passes live signal data into the card", () => {
    const fleet = imageForSignal(SIGNALS[3]);
    expect(fleet).toContain("stat=12"); // the weekly count reaches the card
    expect(fleet).toMatch(/cause=policy/);
    const model = imageForSignal(SIGNALS[1]);
    expect(model).toMatch(/model=Claude/);
  });

  it("gives every regulatory/incident post its own image URL, distinct from every other signal of the same type", () => {
    const a: SocialSignal = { type: "regulatory", title: "EU AI Act Article 12 is now enforceable" };
    const b: SocialSignal = { type: "regulatory", title: "California SB 53 takes effect for frontier models" };
    expect(imageForSignal(a)).not.toEqual(imageForSignal(b));
    expect(imageForSignal(a)).toContain("headline=");

    const c: SocialSignal = { type: "incident", title: "Another agent shipped a wrong refund" };
    const d: SocialSignal = { type: "incident", title: "A support agent leaked a customer's SSN" };
    expect(imageForSignal(c)).not.toEqual(imageForSignal(d));
    expect(imageForSignal(c)).toContain("headline=");
  });
});
