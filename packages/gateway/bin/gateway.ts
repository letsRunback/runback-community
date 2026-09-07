#!/usr/bin/env -S npx tsx
/**
 * runback-gateway — run the recording/replay gateway as a server.
 *
 *   # record: point your agent's API base URL at :8888, calls flow to upstream and are captured
 *   npx tsx node_modules/@runback/gateway/bin/gateway.ts \
 *       --mode record --port 8888 --upstream https://api.openai.com --cassette baseline.cassette.json
 *
 *   # replay (CI gate): serve recorded responses, NO upstream; exits non-zero if the agent diverges
 *   npx tsx node_modules/@runback/gateway/bin/gateway.ts \
 *       --mode replay --port 8888 --cassette baseline.cassette.json
 *
 *   # record, hardened: agents authenticate to the gateway with a token that
 *   # is worthless against the real provider; the real key never leaves this
 *   # process. Without this, "point your base URL at the gateway" doesn't
 *   # stop anyone with the real key from pointing it at the provider
 *   # directly instead — same key, works either way.
 *   RUNBACK_GATEWAY_TOKEN=$(openssl rand -hex 24) \
 *   RUNBACK_GATEWAY_UPSTREAM_KEY="Bearer sk-..." \
 *     npx tsx node_modules/@runback/gateway/bin/gateway.ts \
 *       --mode record --port 8888 --upstream https://api.openai.com \
 *       --upstream-auth-header authorization --cassette baseline.cassette.json
 *   # Anthropic doesn't use a Bearer authorization header — use its own
 *   # scheme instead: --upstream-auth-header x-api-key, and
 *   # RUNBACK_GATEWAY_UPSTREAM_KEY=sk-ant-... (no "Bearer " prefix).
 *
 * Secrets are read from the environment, never from argv — a process's
 * command line is visible to anything else on the same host (`ps`, /proc).
 */
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createGateway } from "../src/index";

/**
 * Atomic write: write to a temp file in the same directory, then rename over
 * the target. A crash mid-write leaves the temp file, never a half-written
 * cassette at `path` — `writeFileSync` alone can leave a truncated/corrupt
 * file at `path` itself if the process dies mid-write.
 */
function writeFileAtomic(path: string, data: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const mode = arg("mode") as "record" | "replay" | undefined;
const port = Number(arg("port") || 8888);
const upstream = arg("upstream");
const cassettePath = arg("cassette");
const upstreamAuthHeader = arg("upstream-auth-header");
const upstreamAuthValue = process.env.RUNBACK_GATEWAY_UPSTREAM_KEY;
const authToken = process.env.RUNBACK_GATEWAY_TOKEN;
const upstreamAuth = upstreamAuthHeader && upstreamAuthValue ? { header: upstreamAuthHeader, value: upstreamAuthValue } : undefined;
if (upstreamAuthHeader && !upstreamAuthValue) {
  console.error("--upstream-auth-header was set but RUNBACK_GATEWAY_UPSTREAM_KEY is not — the real credential would still come from the caller. Set both, or neither.");
  process.exit(2);
}

if (mode === "record") {
  if (!upstream || !cassettePath) {
    console.error("record needs --upstream <url> and --cassette <file>");
    process.exit(2);
  }
  if (!authToken) {
    console.error("Warning: RUNBACK_GATEWAY_TOKEN is not set — this gateway accepts requests from anyone who can reach it. Fine for local dev; set it for anything else.");
  }
  const gw = createGateway({
    mode: "record",
    upstream,
    upstreamAuth,
    authToken,
    // Persist after every captured interaction, not just on a clean exit —
    // this is what actually closes the crash-durability gap: SIGKILL, an
    // OOM kill, or an uncaught exception elsewhere in the process now loses
    // at most the entry currently in flight, never the whole session.
    onEntry: (_entry, cassette) => {
      writeFileAtomic(cassettePath, JSON.stringify(cassette, null, 2));
    },
  });
  gw.server.listen(port, () => console.error(`runback-gateway record :${port} → ${upstream}`));
  const save = () => {
    const c = gw.cassette();
    writeFileAtomic(cassettePath, JSON.stringify(c, null, 2));
    console.error(`\nsaved ${c.entry_count} interactions · digest ${c.digest.slice(0, 12)}… → ${cassettePath}`);
    process.exit(0);
  };
  process.on("SIGINT", save);
  process.on("SIGTERM", save);
  // Last-resort backstop: an uncaught exception elsewhere in the process
  // (not inside the request handler, which already catches) would otherwise
  // crash without running SIGINT/SIGTERM — onEntry already made every
  // captured interaction durable, so this just confirms and exits cleanly
  // rather than leaving the process hung or silently gone.
  process.on("uncaughtException", (err) => {
    console.error("[gateway] uncaught exception — captured interactions were already persisted incrementally:", err);
    try {
      writeFileAtomic(cassettePath, JSON.stringify(gw.cassette(), null, 2));
    } catch { /* best-effort; onEntry already covered the durable path */ }
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    console.error("[gateway] unhandled rejection — captured interactions were already persisted incrementally:", err);
  });
} else if (mode === "replay") {
  if (!cassettePath) {
    console.error("replay needs --cassette <file>");
    process.exit(2);
  }
  const cassette = JSON.parse(readFileSync(cassettePath, "utf8"));
  const gw = createGateway({ mode: "replay", cassette, authToken });
  gw.server.listen(port, () =>
    console.error(`runback-gateway replay :${port} — serving ${cassette.entry_count} recorded responses, NO upstream`)
  );
  const done = () => {
    const d = gw.divergences();
    console.error(`\n${d.length === 0 ? "✅ no divergences — agent reproduced the baseline" : `❌ ${d.length} divergence(s) — agent behaviour changed`}`);
    process.exit(d.length === 0 ? 0 : 1);
  };
  process.on("SIGINT", done);
  process.on("SIGTERM", done);
} else {
  console.error("usage: runback-gateway --mode record|replay --port N [--upstream URL] --cassette FILE");
  process.exit(2);
}
