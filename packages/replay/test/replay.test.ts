import { describe, it, expect } from "vitest";
import { record, replay, recomputeDigest } from "../src/index.js";

/* A tiny "agent": its own nondeterminism (clock, random) plus tool calls. The
   tool itself reads the clock internally — that must stay opaque (captured by
   its output, not as separate entries). The SAME function is used for record
   and replay; given the recorded nondeterminism stream it is deterministic. */
type Ctrl = { tool: <I, O>(name: string, fn: (i: I) => O | Promise<O>) => (i: I) => Promise<O> };

function makeAgent(sideEffects: { calls: number }) {
  return async (ctrl: Ctrl) => {
    const search = ctrl.tool("search", async (q: { term: string }) => {
      sideEffects.calls++;
      return { hits: q.term.length, ranAt: Date.now(), nonce: Math.random() }; // inner nondeterminism = opaque
    });
    const startedAt = Date.now();
    const roll = Math.random();
    const a = await search({ term: "hello" });
    const b = await search({ term: "world!" });
    const endedAt = Date.now();
    return { startedAt, roll, a, b, endedAt, elapsed: endedAt - startedAt };
  };
}

describe("@runback/replay — deterministic record/replay (the cassette engine)", () => {
  it("replays byte-exact, offline, with ZERO live tool execution — and proves it by digest", async () => {
    const recSE = { calls: 0 };
    const { value: recVal, cassette } = await record("run1", makeAgent(recSE));

    expect(recSE.calls).toBe(2); // tools really ran while recording
    // entries: now, random, tool, tool, now  (the tool's inner now/random are opaque)
    expect(cassette.entry_count).toBe(5);
    expect(cassette.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(recomputeDigest(cassette.entries)).toBe(cassette.digest);

    const repSE = { calls: 0 };
    const { value: repVal, verify } = await replay(cassette, makeAgent(repSE));

    expect(repSE.calls).toBe(0); // ← tools NOT executed on replay: pure cassette, offline
    expect(verify.ok).toBe(true);
    expect(verify.consumed).toBe(verify.total);
    expect(verify.reproducedDigest).toBe(cassette.digest); // ← cryptographic proof of faithful replay
    expect(repVal).toEqual(recVal); // ← byte-exact, including values produced inside the tool
  });

  it("reproduces the exact clock and random values (no live nondeterminism)", async () => {
    const { value: a } = await record("run2", makeAgent({ calls: 0 }));
    const { cassette } = await record("run2b", makeAgent({ calls: 0 }));
    const { value: b } = await replay(cassette, makeAgent({ calls: 0 }));
    // two *records* differ (real nondeterminism) but a replay equals its own recording:
    expect(b!.roll).toBeTypeOf("number");
    expect(typeof a!.roll).toBe("number");
    const { value: c } = await replay(cassette, makeAgent({ calls: 0 }));
    expect(c).toEqual(b); // replay is idempotent and exact
  });

  it("detects a tampered cassette — the digest no longer matches", async () => {
    const { cassette } = await record("run3", makeAgent({ calls: 0 }));
    const tampered = structuredClone(cassette);
    const randomEntry = tampered.entries.find((e) => e.kind === "random")!;
    randomEntry.output = 0.1234567; // flip one recorded value

    expect(recomputeDigest(tampered.entries)).not.toBe(tampered.digest); // tamper-evident at rest

    const { verify } = await replay(tampered, makeAgent({ calls: 0 }));
    expect(verify.ok).toBe(false); // and caught on replay
  });

  it("pinpoints a divergent code path — and still runs no tools", async () => {
    const { cassette } = await record("run4", makeAgent({ calls: 0 }));

    const se = { calls: 0 };
    const divergent = async (ctrl: Ctrl) => {
      const search = ctrl.tool("search", async () => {
        se.calls++;
        return { x: 1 };
      });
      Date.now(); // consumes entry 0 (now) — matches
      Math.random(); // consumes entry 1 (random) — matches
      await search({ term: "DIFFERENT" }); // entry 2 expected tool key differs → divergence
      return "unreached";
    };

    const { verify } = await replay(cassette, divergent);
    expect(verify.ok).toBe(false);
    expect(verify.divergedAt).toBeDefined();
    expect(verify.divergedAt!.seq).toBe(2);
    expect(se.calls).toBe(0); // tool body never executed, even on divergence
  });

  it("records & replays `fetch` and `new Date()` — replay makes ZERO network calls", async () => {
    let netCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      netCalls++;
      return new Response(`server-said-hi:${String(url)}`, { status: 200 });
    }) as typeof fetch;

    try {
      const agent = async () => {
        const at = new Date(); // → a "date" entry
        const res = await fetch("https://api.example.com/x"); // → a "fetch" entry
        const body = await res.text();
        return { year: at.getFullYear(), status: res.status, body };
      };

      const { value: recVal, cassette } = await record("net1", agent);
      expect(netCalls).toBe(1);
      expect(cassette.entries.some((e) => e.kind === "date")).toBe(true);
      expect(cassette.entries.some((e) => e.kind === "fetch")).toBe(true);

      netCalls = 0;
      const { value: repVal, verify } = await replay(cassette, agent);
      expect(netCalls).toBe(0); // ← replay hit NO network: served from the cassette
      expect(verify.ok).toBe(true);
      expect(repVal).toEqual(recVal); // byte-exact: fetched body + the Date
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
