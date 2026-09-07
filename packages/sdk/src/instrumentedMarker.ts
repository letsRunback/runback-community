/**
 * Marks "a Runback-instrumented provider call is in flight" — independent of
 * env-capture (captureEnv) and independent of any specific Collector
 * instance, because bypassGuard.ts needs to answer "was THIS fetch, right
 * now, made from inside withDebugger's own middleware" for any agent
 * process, not just ones that opted into deterministic replay capture.
 *
 * Mirrors envCapture.ts's envDepth pattern (AsyncLocalStorage + a depth
 * counter, opaque while >0) rather than reusing it directly — envDepth is
 * scoped to a specific EnvSink, and only meaningful once a sink has been
 * entered via captureEnv. This marker has to work with zero opt-in, since
 * the whole point is detecting a call that skipped Runback's wrapper
 * entirely, which shouldn't require the agent to have configured anything
 * beyond installBypassGuard() once at startup.
 *
 * Honest limit: AsyncLocalStorage's context does NOT propagate across a
 * worker_thread or child_process boundary — each has its own JS heap/event
 * loop, so a store started in the parent is simply absent in the child. A
 * tool that runs inside a worker/subprocess (a common sandboxing pattern for
 * agent tool execution) and makes an instrumented provider call from there
 * will see isInstrumentedCall() return false even though the call genuinely
 * went through withDebugger's middleware first — bypassGuard.ts would then
 * flag it as a bypass (a false positive in "observe" mode, an incorrectly
 * blocked call in "block" mode). This is a real, currently-unclosed gap, not
 * a hypothetical: any setup that isolates tool execution in a worker/
 * subprocess for sandboxing defeats both env capture's opacity bracketing
 * AND bypass detection the same way. Closing it needs an explicit
 * context-propagation bridge across the boundary (e.g. passing a token
 * through worker `postMessage`/subprocess IPC and re-entering the marker on
 * the other side) — out of scope here; see instrumentedMarker.test.ts for a
 * test that proves the gap rather than papering over it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

interface Marker {
  depth: number;
}

const als = new AsyncLocalStorage<Marker>();

/** True while inside a Runback-instrumented provider call (debuggerMiddleware). */
export function isInstrumentedCall(): boolean {
  const s = als.getStore();
  return !!s && s.depth > 0;
}

/**
 * Run `fn` marked as an instrumented provider call. Nests correctly across
 * concurrent/async calls sharing an async context. Accepts PromiseLike (not
 * just Promise) since the AI SDK's own doGenerate()/doStream() return types
 * are typed as PromiseLike, not Promise.
 */
export async function runInstrumented<T>(fn: () => T | PromiseLike<T>): Promise<T> {
  const existing = als.getStore();
  if (!existing) {
    return als.run({ depth: 0 }, () => runInstrumented(fn));
  }
  existing.depth++;
  try {
    return await fn();
  } finally {
    existing.depth--;
  }
}
