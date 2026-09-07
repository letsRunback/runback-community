/**
 * Runback recording gateway — the language-agnostic capture tier.
 *
 * Any agent, in any language, points its API base URL (or HTTP proxy) at this
 * gateway. No SDK, no code change, no support. In RECORD mode it forwards each
 * request to the real upstream and captures the response into a cassette (the
 * same content-addressed, hash-chained format as the in-process tier, so it
 * fuses into the signed audit). In REPLAY mode it serves those recorded
 * responses and makes NO upstream call — the run reproduces offline. Any request
 * the agent makes that ISN'T in the cassette is a behaviour divergence: that is
 * the network-level CI release gate.
 *
 * This is "capture, not facilitate": you sit in the path of every external call
 * the agent makes, across every industry, with one base-URL change.
 */
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  chainStep,
  sha256,
  proxyKey,
  CASSETTE_SCHEMA,
  type Cassette,
  type Entry,
} from "@runback/replay";
import { createRedactor, type RedactOptions } from "@runback/redact";

/**
 * Constant-time string compare. A caller-controlled token compared with `===`
 * leaks its length/prefix via response timing; this is cheap insurance for a
 * value (`authToken`) that exists specifically to gate access to the gateway.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface HttpOutput {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}

export interface GatewayOptions {
  /** Real upstream base URL to forward to in record mode (e.g. https://api.openai.com). */
  upstream?: string;
  mode: "record" | "replay";
  /** In replay mode, the baseline cassette to serve from. */
  cassette?: Cassette;
  runId?: string;
  /**
   * Scrub secrets/PII from each captured response (body + header values) BEFORE it
   * is written to the cassette — the gateway-tier analogue of the SDK's in-process
   * redaction, so a recorded HTTP cassette can't leak credentials. Off by default
   * (replay serves the exact bytes); opt in for VC-committed / shared cassettes.
   */
  redact?: boolean | "standard" | "strict" | RedactOptions;
  /**
   * Real upstream credential, injected into every forwarded request
   * server-side — replacing whatever the caller sent for that header, not
   * merging with it. Without this, record mode forwards the caller's own
   * `authorization` header untouched, which means the exact key that works
   * calling the gateway ALSO works calling the real provider directly:
   * nothing about "point your base URL at the gateway" stops an agent (or a
   * developer) from pointing it right back at api.openai.com with the same
   * key, and the gateway has no way to tell. Setting this closes that: the
   * real key lives only here, agents authenticate with `authToken` (below)
   * instead, and that token is meaningless to the real provider.
   */
  upstreamAuth?: { header: string; value: string };
  /**
   * Gateway-scoped bearer token callers must present as
   * `Authorization: Bearer <authToken>` for a request to be forwarded at
   * all. Distinct from `upstreamAuth.value` on purpose: rotating or
   * revoking this has zero effect on the real provider credential, and it
   * carries no privilege the real API would ever honour on its own.
   * Unset by default (matches prior behaviour — fine for local dev, not for
   * anything reachable beyond localhost).
   */
  authToken?: string;
  /**
   * Called synchronously right after each entry is captured in record mode —
   * BEFORE the response is written back to the agent. Without this, captured
   * interactions lived only in the in-memory `entries` array, flushed to disk
   * solely by the CLI's graceful SIGINT/SIGTERM handler (see bin/gateway.ts).
   * A crash (OOM, SIGKILL, an uncaught exception) between two graceful
   * shutdowns lost the entire cassette — including entries where the real
   * upstream side-effecting call (a payment, a write) had already happened.
   * For a "capture, not facilitate" audit trail, losing the record of what
   * happened is the one failure mode that can't be tolerated. The CLI uses
   * this to persist incrementally instead of relying on a clean exit.
   */
  onEntry?: (entry: Entry, cassette: Cassette) => void;
}

// Response headers that must NOT be replayed verbatim: hop-by-hop, volatile, or
// transport-encoding headers that would corrupt a served (already-decoded) body.
const VOLATILE_RES = new Set([
  "connection", "keep-alive", "transfer-encoding", "content-length",
  "content-encoding", "date", "server", "alt-svc",
]);

/** pathname + query with query params sorted by name, so a logically-identical
 *  request keys identically even when param order is nondeterministic (e.g. built
 *  from a hash map). Record and replay both canonicalize, so they always agree. */
function canonicalPath(raw: string): string {
  try {
    const u = new URL(raw, "http://x");
    u.searchParams.sort();
    return u.pathname + u.search;
  } catch {
    return raw;
  }
}

export interface Gateway {
  server: http.Server;
  /** The cassette captured so far (record mode). */
  cassette(): Cassette;
  /** Requests in replay mode with no recorded match — behaviour divergences. */
  divergences(): { method: string; path: string }[];
}

const HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "accept-encoding"]);
function fwdHeaders(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (!HOP.has(k.toLowerCase()) && typeof v === "string") out[k] = v;
  return out;
}

export function createGateway(opts: GatewayOptions): Gateway {
  const entries: Entry[] = [];
  let prev = "";
  let seq = 0;
  const diverged: { method: string; path: string }[] = [];
  const redactor = opts.redact ? createRedactor(opts.redact) : null;
  const scrub = (s: string): string => (redactor ? String(redactor.redactValue(s)) : s);

  const buildCassette = (): Cassette => ({
    schema: CASSETTE_SCHEMA,
    run_id: opts.runId || "gateway",
    created_at: new Date().toISOString(),
    entry_count: entries.length,
    digest: prev || sha256(""),
    entries,
  });

  /** Capture a response's headers for replay — minus volatile/transport ones that
   *  would corrupt a served body — scrubbing each value when redaction is on. */
  const captureHeaders = (h: Headers): Record<string, string> => {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      if (!VOLATILE_RES.has(k.toLowerCase())) out[k] = scrub(v);
    });
    if (!out["content-type"]) out["content-type"] = "application/json";
    return out;
  };

  // replay: content-addressed FIFO per key (handles repeats and concurrency).
  const byKey = new Map<string, Entry[]>();
  if (opts.mode === "replay") {
    for (const e of opts.cassette?.entries ?? []) {
      const a = byKey.get(e.key) ?? [];
      a.push(e);
      byKey.set(e.key, a);
    }
  }

  const server = http.createServer(async (req, res) => {
    // Gate access to the gateway itself, before reading the body or making
    // any upstream call. Checked here — not left implicit — because once
    // upstreamAuth is configured, THIS is the only thing standing between
    // "anyone who can reach this port" and the real provider credential.
    if (opts.authToken) {
      const auth = req.headers["authorization"];
      const presented = typeof auth === "string" ? auth : "";
      if (!timingSafeEqualStr(presented, `Bearer ${opts.authToken}`)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ runback_gateway: "unauthorized", message: "missing or invalid gateway token" }));
        return;
      }
    }

    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const method = (req.method || "GET").toUpperCase();
    const path = req.url || "/";
    // Reject anything but an origin-form path ("/...") so a crafted target like
    // "@evil.com/x" can't make `upstream + path` resolve to a different host (which
    // would forward the agent's headers off-target). The upstream host stays pinned.
    if (!path.startsWith("/")) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ runback_gateway: "bad_request", message: "path must be origin-form (start with '/')" }));
      return;
    }
    // Key by the canonical path (query params sorted) so logically-identical
    // requests match across runs; forward the ORIGINAL path upstream unchanged.
    const key = proxyKey(method, canonicalPath(path), body);

    if (opts.mode === "replay") {
      const q = byKey.get(key);
      const e = q && q.shift();
      if (!e) {
        diverged.push({ method, path });
        res.writeHead(409, { "content-type": "application/json", "x-runback-gateway": "divergence" });
        res.end(JSON.stringify({ runback_gateway: "divergence", message: "no recorded response — agent behaviour changed", method, path }));
        return;
      }
      const out = e.output as HttpOutput;
      res.writeHead(out.status, out.headers);
      res.end(out.bodyText);
      return;
    }

    // record: forward to the real upstream and capture deterministically.
    try {
      const base = (opts.upstream || "").replace(/\/$/, "");
      const headers = fwdHeaders(req.headers);
      if (opts.upstreamAuth) {
        // Drop whatever the caller sent for this header — never merge with
        // it — then inject the real credential. The caller's own value (if
        // any) never reaches the upstream, so it's never a working credential
        // for it either.
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === opts.upstreamAuth.header.toLowerCase()) delete headers[k];
        }
        headers[opts.upstreamAuth.header] = opts.upstreamAuth.value;
      }
      const r = await fetch(base + path, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
      });
      const bodyText = await r.text();
      // Store the FULL (non-volatile) response — headers + body — so a stateful
      // replay is faithful (set-cookie/etag/cache-control are preserved), scrubbed
      // when redaction is on. The live agent still gets the real bytes below.
      const output: HttpOutput = {
        status: r.status,
        headers: captureHeaders(r.headers),
        bodyText: scrub(bodyText),
      };
      prev = chainStep(prev, { kind: "http", key, output });
      const entry: Entry = { seq: seq++, kind: "http", key, output, hash: prev };
      entries.push(entry);
      // Persist BEFORE responding to the agent — if the process dies right
      // after this line, the entry is already durable; if it dies before,
      // the upstream call (and any real side effect) never happened either,
      // so there's nothing to have lost.
      try {
        opts.onEntry?.(entry, buildCassette());
      } catch (persistErr) {
        // A broken persistence hook must never break capture itself — the
        // in-memory entries array (and the graceful-shutdown save) is still
        // the fallback.
        console.error("[gateway] onEntry persistence hook failed:", persistErr);
      }
      // Serve the real upstream response to the agent during recording.
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json" });
      res.end(bodyText);
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ runback_gateway: "upstream_error", message: String(err) }));
    }
  });

  return {
    server,
    cassette: buildCassette,
    divergences: () => diverged,
  };
}
