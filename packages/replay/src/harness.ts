/**
 * The record/replay harness.
 *
 * RECORD installs shims over the runtime's nondeterminism sources (Date.now,
 * Math.random, crypto.randomUUID) and wraps tools, appending every value that
 * crosses the boundary into a cassette as it actually happens.
 *
 * REPLAY installs shims that, instead of producing live values, hand back the
 * RECORDED values in the recorded order — and execute NO tools, touch NO clock,
 * draw NO randomness, make NO network calls. The run reproduces from the cassette
 * alone: offline, byte-exact. As it consumes the cassette it recomputes the hash
 * chain; `verify.ok` is true only if it consumed every entry, in order, to the
 * exact recorded digest. Any divergence (a changed code path, uncaptured
 * nondeterminism, a tampered cassette) is pinpointed at the entry it first breaks.
 */
import {
  type Cassette,
  type Entry,
  type EntryKind,
  CASSETTE_SCHEMA,
  chainStep,
  sha256,
  toolKey,
  fetchKey,
} from "./cassette";

/* eslint-disable @typescript-eslint/no-explicit-any */

type ToolFn<I, O> = (input: I) => O | Promise<O>;

export interface RecordController {
  /** Wrap a tool so its output is recorded. Pass the wrapped fn to your agent. */
  tool<I, O>(name: string, fn: ToolFn<I, O>): (input: I) => Promise<O>;
}
export interface ReplayController {
  /** Wrap a tool; on replay `fn` is NEVER called — the recorded output is returned. */
  tool<I, O>(name: string, fn?: ToolFn<I, O>): (input: I) => Promise<O>;
}

interface Shims {
  restore: () => void;
}

/** Override the runtime's synchronous nondeterminism sources; return a restorer. */
function installShims(onCall: (kind: EntryKind) => unknown): Shims {
  const RealDate = globalThis.Date;
  const realNow = RealDate.now;
  const realRandom = Math.random;
  const cryptoObj: any = (globalThis as any).crypto;
  const realUuid: (() => string) | undefined = cryptoObj?.randomUUID?.bind(cryptoObj);

  RealDate.now = () => onCall("now") as number;
  Math.random = () => onCall("random") as number;

  // `new Date()` with no args reads the wall clock — record/replay that read.
  // `new Date(x)` delegates unchanged; instances stay `instanceof Date`.
  class ShimDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(onCall("date") as number);
      else super(...(args as ConstructorParameters<typeof Date>));
    }
  }
  (globalThis as { Date: DateConstructor }).Date = ShimDate as unknown as DateConstructor;

  // crypto.randomUUID may be non-writable on some runtimes — best-effort.
  let uuidShimmed = false;
  if (realUuid) {
    try {
      cryptoObj.randomUUID = () => onCall("uuid") as string;
      uuidShimmed = true;
    } catch {
      /* not interceptable here; uuid simply isn't captured on this runtime */
    }
  }

  return {
    restore() {
      RealDate.now = realNow;
      Math.random = realRandom;
      (globalThis as { Date: DateConstructor }).Date = RealDate;
      if (uuidShimmed) {
        try {
          cryptoObj.randomUUID = realUuid!;
        } catch {
          /* ignore */
        }
      }
    },
  };
}

// ── RECORD ────────────────────────────────────────────────────────────────────
export async function record<T>(
  runId: string,
  body: (rec: RecordController) => T | Promise<T>
): Promise<{ value: T; cassette: Cassette }> {
  const entries: Entry[] = [];
  let prev = "";
  let seq = 0;

  const append = (kind: EntryKind, key: string, output: unknown): unknown => {
    const hash = chainStep(prev, { kind, key, output });
    prev = hash;
    entries.push({ seq: seq++, kind, key, output, hash });
    return output;
  };

  // primitives capture their REAL value (computed before the shim recorded it)
  const real = { now: Date.now, random: Math.random };
  const cryptoObj: any = (globalThis as any).crypto;
  const realUuid: (() => string) | undefined = cryptoObj?.randomUUID?.bind(cryptoObj);

  // A tool is an opaque oracle: nondeterminism INSIDE it is captured by its
  // recorded output, not as separate entries (on replay the tool body never
  // runs). This depth guard suppresses primitive recording while inside a tool.
  let inTool = 0;
  const shims = installShims((kind) => {
    const v =
      kind === "now" || kind === "date"
        ? real.now()
        : kind === "random"
          ? real.random()
          : realUuid
            ? realUuid()
            : "";
    return inTool > 0 ? v : append(kind, kind, v);
  });

  // fetch is async: record the real response (VCR-style), opaque inside tools.
  const origFetch: any = (globalThis as any).fetch;
  const realFetch = origFetch ? origFetch.bind(globalThis) : null;
  if (realFetch) {
    (globalThis as any).fetch = async (input: any, init?: any) => {
      if (inTool > 0) return realFetch(input, init);
      const method = String(init?.method ?? input?.method ?? "GET");
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      // The network library is an opaque oracle — its internal clock/random reads
      // are captured by the recorded response, not as separate entries.
      inTool++;
      let res: any;
      let bodyText = "";
      try {
        res = await realFetch(input, init);
        try {
          bodyText = await res.clone().text();
        } catch {
          /* non-text body */
        }
      } finally {
        inTool--;
      }
      append("fetch", fetchKey(method, url), { status: res.status, statusText: res.statusText, bodyText });
      return res;
    };
  }

  const rec: RecordController = {
    tool: (name, fn) => async (input) => {
      inTool++;
      let output: any;
      try {
        output = await fn(input);
      } finally {
        inTool--;
      }
      return append("tool", toolKey(name, input), output) as any;
    },
  };

  let value: T;
  try {
    value = await body(rec);
  } finally {
    shims.restore();
    if (origFetch) (globalThis as any).fetch = origFetch;
  }

  const cassette: Cassette = {
    schema: CASSETTE_SCHEMA,
    run_id: runId,
    created_at: new Date().toISOString(),
    entry_count: entries.length,
    digest: prev || sha256(""),
    entries,
  };
  return { value, cassette };
}

// ── REPLAY ──────────────────────────────────────────────────────────────────
export class ReplayDivergence extends Error {}

export interface VerifyOutcome {
  ok: boolean;
  consumed: number;
  total: number;
  reproducedDigest: string;
  recordedDigest: string;
  /** Set when the replay's interaction stream first departs from the recording. */
  divergedAt?: { seq: number; expected: string; got: string };
}

export async function replay<T>(
  cassette: Cassette,
  body: (play: ReplayController) => T | Promise<T>
): Promise<{ value: T | undefined; verify: VerifyOutcome }> {
  let i = 0;
  let prev = "";
  let diverged: VerifyOutcome["divergedAt"];

  const consume = (kind: EntryKind, key: string): unknown => {
    const e = cassette.entries[i];
    if (!e) {
      diverged ??= { seq: i, expected: "<end-of-cassette>", got: `${kind}:${key}` };
      throw new ReplayDivergence("cassette exhausted before the run finished");
    }
    const keyMatches = kind === "tool" || kind === "fetch" ? e.key === key : true;
    if (e.kind !== kind || !keyMatches) {
      diverged ??= { seq: i, expected: `${e.kind}:${e.key}`, got: `${kind}:${key}` };
      throw new ReplayDivergence(`divergence at entry ${i}`);
    }
    prev = chainStep(prev, { kind: e.kind, key: e.key, output: e.output });
    i++;
    return e.output;
  };

  const shims = installShims((kind) => consume(kind, kind));
  const play: ReplayController = {
    tool: (name) => async (input) => consume("tool", toolKey(name, input)) as any,
  };

  // replay fetch from the cassette — no network, ever.
  const origFetch: any = (globalThis as any).fetch;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const method = String(init?.method ?? input?.method ?? "GET");
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const rec = consume("fetch", fetchKey(method, url)) as { status?: number; statusText?: string; bodyText?: string };
    return new Response(rec?.bodyText ?? "", { status: rec?.status ?? 200, statusText: rec?.statusText ?? "" });
  };

  let value: T | undefined;
  try {
    value = await body(play);
  } catch (err) {
    if (!(err instanceof ReplayDivergence)) throw err;
  } finally {
    shims.restore();
    (globalThis as any).fetch = origFetch;
  }

  const reproducedDigest = prev || sha256("");
  const verify: VerifyOutcome = {
    ok: !diverged && i === cassette.entries.length && reproducedDigest === cassette.digest,
    consumed: i,
    total: cassette.entries.length,
    reproducedDigest,
    recordedDigest: cassette.digest,
    divergedAt: diverged,
  };
  return { value, verify };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
