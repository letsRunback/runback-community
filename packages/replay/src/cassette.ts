/**
 * Cassette — the deterministic record of a run's nondeterminism.
 *
 * Every value that enters an agent run from outside the pure computation — a
 * tool's output, the clock, a random draw, a generated UUID — is appended as an
 * Entry, content-addressed and hash-chained. The final `digest` content-addresses
 * the WHOLE nondeterminism stream: replaying the same code while feeding these
 * recorded values back must reproduce the identical stream and therefore the
 * identical digest. Digest equality is a cryptographic proof of faithful,
 * deterministic reproduction — the thing a read-only log can never give you.
 *
 * This is the substrate of the moat: not a UI, an infrastructure invariant.
 *
 * canonical()/sha256() live in ./hash (shared with cassette-enterprise.ts, to
 * avoid a cycle). toolKeyP()/llmKeyP() — the H2 salience-projection-aware
 * keying oracleEntryOf() below actually uses — live in ./cassette-enterprise
 * per LICENSING.md; re-exported here so every existing import of
 * `@runback/replay` keeps working unchanged.
 */
import type { KeyProjection, TraceEvent } from "@runback/schema";
import { canonical, sha256 } from "./hash";

export { canonical, sha256 } from "./hash";

export const CASSETTE_SCHEMA = "runback.cassette/v1" as const;

/**
 * The boundaries we intercept. `tool/now/random/uuid/date/fetch` are the
 * in-process (SDK) tier; `http` is the language-agnostic GATEWAY tier; `clock`
 * is the NATIVE tier (libc interposition over any binary, any language).
 */
export type EntryKind = "tool" | "now" | "random" | "uuid" | "date" | "fetch" | "http" | "clock";

export interface Entry {
  seq: number;
  kind: EntryKind;
  /** Content address: for tools, hash(name + canonical(input)); for primitives, the kind. */
  key: string;
  /** The recorded value handed back to the computation. */
  output: unknown;
  /** Chain hash up to and including this entry. */
  hash: string;
}

export interface Cassette {
  schema: typeof CASSETTE_SCHEMA;
  run_id: string;
  created_at: string;
  entry_count: number;
  /** Final chain hash — content-addresses the entire nondeterminism stream. */
  digest: string;
  entries: Entry[];
  /**
   * Salience projection (H2) per tool name, so a replay engine recomputes the SAME
   * content key from a live input that the recording used — otherwise a run that
   * declared volatile fields would false-MISS on replay (the projected entry key
   * never matches a raw lookup). Absent ⇒ keys are raw (backward compatible).
   */
  projections?: Record<string, KeyProjection>;
}

/** A tool call's content address. Same name + same input ⇒ same key. */
export function toolKey(name: string, input: unknown): string {
  return sha256(`tool:${name}:${canonical(input)}`);
}

/** A model call's content address (model id + request). Same model + same request ⇒ same key. */
export function llmKey(modelId: string, request: unknown): string {
  return sha256(`llm:${modelId}:${canonical(request)}`);
}

/* ── Seam for H2 salience projection (commercially licensed) ─────────────────
 *
 * oracleEntryOf() below defines what enters the audit hash chain, so it must
 * work in a Community build — but projection-aware keying is licensed
 * (LICENSING.md). This registry lets ./cassette-enterprise fill it in when
 * present, WITHOUT cassette.ts importing that file.
 *
 * The fallback is safe rather than merely convenient, and only because of a
 * property that is asserted in cassetteBoundary.test.ts rather than assumed:
 * with no projection set, the licensed keyers return byte-identical output to
 * the plain toolKey()/llmKey(). A Community deployment never writes a
 * key_projection, so it takes the fallback on every event and computes exactly
 * the chain an Enterprise build would.
 *
 * The one case where they would diverge — an event that DOES carry a
 * projection reaching a build with no implementation (e.g. an Enterprise SDK
 * feeding a Community server) — throws instead of quietly computing a
 * different key. A wrong key here produces a valid-LOOKING digest that fails
 * to verify later, which is precisely the silent corruption this product
 * exists to rule out.
 */
export interface KeyProjectionImpl {
  toolKeyP(name: string, input: unknown, projection?: KeyProjection): string;
  llmKeyP(modelId: string, request: unknown, projection?: KeyProjection): string;
}

let projectionImpl: KeyProjectionImpl | null = null;

/** Called by ./cassette-enterprise at import time. Not part of the public API. */
export function registerKeyProjection(impl: KeyProjectionImpl): void {
  projectionImpl = impl;
}

/** True when a projection is actually requested — an absent/empty one is a no-op. */
function hasProjection(p?: KeyProjection): boolean {
  return !!p && ((p.keep?.length ?? 0) > 0 || (p.drop?.length ?? 0) > 0);
}

function requireImpl(): KeyProjectionImpl {
  if (!projectionImpl) {
    throw new Error(
      "This record declares a key_projection, which requires the Runback deep-replay " +
        "module. Computing a plain key instead would silently produce a digest that " +
        "cannot be verified against the original."
    );
  }
  return projectionImpl;
}

/** Tool content address, projection-aware when one is set and available. */
export function toolKeyFor(name: string, input: unknown, projection?: KeyProjection): string {
  return hasProjection(projection)
    ? requireImpl().toolKeyP(name, input, projection)
    : toolKey(name, input);
}

/** Model content address, projection-aware when one is set and available. */
export function llmKeyFor(modelId: string, request: unknown, projection?: KeyProjection): string {
  return hasProjection(projection)
    ? requireImpl().llmKeyP(modelId, request, projection)
    : llmKey(modelId, request);
}

/** A fetch's content address — method + URL. */
export function fetchKey(method: string, url: string): string {
  return sha256(`fetch:${method.toUpperCase()}:${url}`);
}

/** A gateway request's content address — method + path + request body. */
export function proxyKey(method: string, path: string, body: string): string {
  return sha256(`http:${method.toUpperCase()}:${path}:${sha256(body)}`);
}

/** One step of the hash chain over an entry's defining content (not its own hash). */
export function chainStep(prev: string, e: { kind: string; key: string; output: unknown }): string {
  return sha256(prev + canonical({ kind: e.kind, key: e.key, output: e.output }));
}

/** Recompute a cassette's digest from its entries — used to verify integrity. */
export function recomputeDigest(entries: Entry[]): string {
  let prev = "";
  for (const e of entries) prev = chainStep(prev, e);
  return prev || sha256("");
}

/* ── The single source of truth: a trace event's oracle-chain entry ──────────── */

/** One entry in the oracle/nondeterminism chain (pre-hash): what defines its identity. */
export interface OracleEntry {
  /** Chain kind — "llm" | "tool" for the oracle, or the env kind (now/random/uuid/date/fetch). */
  kind: string;
  /** Content address of the request/input/read. */
  key: string;
  /** The recorded value handed back to the computation. */
  output: unknown;
}

/**
 * Map a trace event to the entry it contributes to the deterministic chain, or
 * `null` if it isn't a nondeterminism boundary (run/reasoning envelopes).
 *
 * This is THE definition of "what enters the cassette," used by every chaining
 * site — the SDK collector at capture time, `cassetteDigestFromEvents` on the
 * server, and `reexecuteRun` during verification — so the four digests are
 * identical by construction and can never drift. Env reads (clock, randomness,
 * UUIDs, network) chain alongside the llm/tool oracle: a run that captured them
 * reproduces byte-for-byte, not merely at decision grain.
 */
export function oracleEntryOf(e: TraceEvent): OracleEntry | null {
  if (e.type === "llm") {
    return { kind: "llm", key: llmKeyFor(e.model.model_id, e.request, e.key_projection), output: e.error ? { error: e.error } : e.response };
  }
  if (e.type === "tool") {
    return { kind: "tool", key: toolKeyFor(e.tool_name, e.input, e.key_projection), output: e.error ? { error: e.error } : e.output };
  }
  if (e.type === "env") {
    return { kind: e.kind, key: e.key, output: e.output };
  }
  return null;
}
