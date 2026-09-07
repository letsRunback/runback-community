/**
 * Detects a model-provider call made OUTSIDE Runback's own instrumentation —
 * an agent process that wraps SOME calls with withDebugger() but also calls
 * a provider directly, unwrapped, somewhere else. That call is completely
 * invisible today: no captured context, no policy gate, no audit record.
 * Gateway mode (base-URL swap, @runback/gateway) closed the equivalent gap
 * for language-agnostic integrations by isolating the real provider
 * credential server-side — an agent literally can't hold a working direct
 * key once that's configured. There is no equivalent credential to isolate
 * here: the SDK never held a separate token from the real provider key in
 * the first place, so this can't make a direct call fail the way gateway
 * mode does. What it CAN do is turn a silent bypass into an observed one.
 *
 * Usage — call once, at process startup, before any withDebugger() calls
 * (or pass `enforceCapture: true` to withDebugger, which calls this for you
 * with defaults):
 *
 *   import { installBypassGuard } from "@runback/sdk";
 *   installBypassGuard(); // mode: "observe" by default — reports, never blocks
 *
 * "observe" (default) matches the runtime policy gate's own fail-open
 * default (see /security — "Policy gates fail open by default so your
 * agent is never blocked by an infrastructure outage"): reports the bypass
 * as a finding and lets the call through. "block" throws instead, for
 * environments where refusing an unrecorded provider call is the safer
 * default than allowing one.
 *
 * Reporting works identically against the hosted service and a self-hosted
 * instance — it posts to the same ingestUrl/apiKey (RUNBACK_INGEST_URL /
 * RUNBACK_API_KEY) the run events themselves go to, so a self-hosted org
 * never has bypass reports leaving its own perimeter.
 *
 * Honest limit: detection relies on isInstrumentedCall() (instrumentedMarker.ts),
 * which is AsyncLocalStorage-based and does NOT propagate across a
 * worker_thread/child_process boundary — a real, currently-unclosed gap for
 * any setup that runs agent tools inside a worker/subprocess sandbox. See
 * instrumentedMarker.ts's docstring for the detail.
 */
import { isInstrumentedCall } from "./instrumentedMarker.js";

export interface BypassEvent {
  ts: string;
  method: string;
  /** Origin + path only — query strings are stripped before this is ever recorded or sent, since some providers pass keys as query params. */
  url: string;
  hostname: string;
  mode: "observe" | "block";
}

export interface BypassGuardOptions {
  /** Hostnames considered "must go through Runback". Matched as exact, subdomain, or substring. Defaults to the major LLM providers. */
  hostnames?: string[];
  mode?: "observe" | "block";
  /** Called on every detected bypass, in addition to the built-in reporter. Never throws from here — a broken callback must not turn "observe" into a crash. */
  onBypass?: (info: BypassEvent) => void;
  /** Defaults to RUNBACK_INGEST_URL, same as run ingestion. */
  ingestUrl?: string;
  /** Defaults to RUNBACK_API_KEY. */
  apiKey?: string;
}

const DEFAULT_HOSTNAMES = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "api.mistral.ai",
  "api.cohere.ai",
  "bedrock-runtime", // matches *.bedrock-runtime.<region>.amazonaws.com
  "openai.azure.com",
];

let installed = false;

function matchedHost(url: string, hostnames: string[]): string | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const h of hostnames) {
    if (host === h || host.endsWith(`.${h}`) || host.includes(h)) return host;
  }
  return null;
}

/** Strip query string and credentials before a URL is ever recorded or sent — some providers accept an API key as a query param. */
function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "[unparseable url]";
  }
}

async function reportBypass(event: BypassEvent, ingestUrl: string, apiKey: string | undefined): Promise<void> {
  if (!apiKey) {
    console.warn("[runback] bypass detected but no RUNBACK_API_KEY set — cannot report it:", event.hostname);
    return;
  }
  try {
    const res = await fetch(`${ingestUrl.replace(/\/$/, "")}/api/ingest/bypass`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ events: [event] }),
    });
    if (!res.ok) {
      console.warn(`[runback] bypass report failed ${res.status} — the bypass still happened, we just couldn't tell you about it centrally.`);
    }
  } catch (err) {
    console.warn(`[runback] bypass report errored: ${(err as Error).message}`);
  }
}

/** Idempotent — safe to call multiple times (e.g. once per withDebugger call via enforceCapture); installs at most once per process. */
export function installBypassGuard(opts: BypassGuardOptions = {}): void {
  if (installed) return;
  installed = true;

  const hostnames = opts.hostnames ?? DEFAULT_HOSTNAMES;
  const mode = opts.mode ?? "observe";
  const ingestUrl = opts.ingestUrl ?? process.env.RUNBACK_INGEST_URL ?? "http://localhost:3000";
  const apiKey = opts.apiKey ?? process.env.RUNBACK_API_KEY;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const realFetch: typeof fetch | null = g.fetch ? g.fetch.bind(globalThis) : null;
  if (!realFetch) return;

  g.fetch = async (input: unknown, init?: RequestInit) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyInput = input as any;
    const url = typeof input === "string" ? input : (anyInput?.url ?? String(input));
    const method = String(init?.method ?? anyInput?.method ?? "GET");

    if (!isInstrumentedCall()) {
      const host = matchedHost(url, hostnames);
      if (host) {
        const event: BypassEvent = { ts: new Date().toISOString(), method, url: sanitizeUrl(url), hostname: host, mode };
        try {
          opts.onBypass?.(event);
        } catch {
          /* a broken callback must not affect the real call */
        }
        void reportBypass(event, ingestUrl, apiKey);
        if (mode === "block") {
          throw new Error(
            `[runback] Blocked an unwrapped call to ${host} — this request did not go through withDebugger(). ` +
              `Wrap the model with @runback/sdk, or install with { mode: "observe" } to allow and report instead of blocking.`
          );
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (realFetch as any)(input, init);
  };
}

/** Test-only: reset the module-level install guard so tests can reinstall against a fresh fetch mock. Not exported from index.ts. */
export function __resetForTests(): void {
  installed = false;
}
