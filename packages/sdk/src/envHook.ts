/**
 * The seam between the Community collector and the commercially-licensed H1
 * environment-capture implementation (LICENSING.md: "Deep replay — H1
 * environment capture: packages/sdk/src/enterprise/envCapture.ts, `captureEnv` path in
 * packages/sdk/src/collector.ts").
 *
 * collector.ts used to import enterprise/envCapture.ts directly, which meant
 * the Community collector couldn't compile without the licensed file present.
 * It now depends only on this file: the EnvSink CONTRACT (which Collector
 * implements, and which is just an interface — no licensed logic) plus a
 * registration slot the enterprise module fills on import.
 *
 * Failure behaviour is deliberately split, because the two entry points mean
 * different things:
 *
 *   • `captureEnv: true` is an explicit opt-in to H1. If the implementation
 *     isn't present, that request cannot be honoured, so registerless use
 *     THROWS rather than recording an incomplete cassette that looks
 *     complete. A run silently missing its clock/random reads would still
 *     produce a valid-looking digest — it just wouldn't reproduce byte-exactly
 *     later, which is exactly the kind of quiet wrongness this product exists
 *     to prevent.
 *
 *   • `withEnvCaptureIfAvailable()` backs the ergonomic `dbg.capture(fn)`
 *     wrapper. There, passing the function through unchanged is genuinely
 *     correct for Community — the run is still captured at llm/tool grain,
 *     just not byte-exact — so it warns once and proceeds instead of
 *     breaking a documented API for anyone following the quickstart.
 */

export type EnvKind = "now" | "date" | "random" | "uuid" | "fetch";

export interface EnvSink {
  /** Record one captured boundary value handed back to the computation. */
  recordEnv(kind: EnvKind, key: string, output: unknown): void;
  /** >0 while inside a tool, a model call, or an internal op — capture is opaque then. */
  envDepth: number;
}

export interface EnvCaptureImpl {
  enterEnvCapture(sink: EnvSink): void;
  withEnvCapture<T>(sink: EnvSink, fn: () => T): T;
}

let impl: EnvCaptureImpl | null = null;
let warned = false;

/** Called by the H1 implementation at import time. Not part of the public API. */
export function registerEnvCapture(i: EnvCaptureImpl): void {
  impl = i;
}

/** True when an H1 implementation has been registered. */
export function envCaptureAvailable(): boolean {
  return impl !== null;
}

/** Activate env capture for this async context. Throws if H1 isn't available — see the file header. */
export function enterEnvCaptureOrThrow(sink: EnvSink): void {
  if (!impl) {
    throw new Error(
      "captureEnv requires the Runback environment-capture module, which isn't " +
        "present in this build. Remove `captureEnv` to record at decision grain " +
        "(model and tool calls), which needs no licence."
    );
  }
  impl.enterEnvCapture(sink);
}

/** Run `fn` inside an env-capture scope when available; otherwise run it unchanged. */
export function withEnvCaptureIfAvailable<T>(sink: EnvSink, fn: () => T): T {
  if (!impl) {
    if (!warned) {
      warned = true;
      console.warn(
        "[runback] capture() ran without the environment-capture module: this run " +
          "is recorded at decision grain (model and tool calls), not byte-exact."
      );
    }
    return fn();
  }
  return impl.withEnvCapture(sink, fn);
}
