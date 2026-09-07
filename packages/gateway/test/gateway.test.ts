import { describe, it, expect } from "vitest";
import http from "node:http";
import { createGateway } from "../src/index.js";
import { recomputeDigest } from "@runback/replay";

const listen = (s: http.Server): Promise<number> =>
  new Promise((res) => s.listen(0, "127.0.0.1", () => res((s.address() as { port: number }).port)));
const close = (s: http.Server): Promise<void> => new Promise((r) => s.close(() => r()));

describe("@runback/gateway — language-agnostic record/replay (capture tier)", () => {
  it("records upstream calls, replays them offline, and gates divergences", async () => {
    let upstreamHits = 0;
    const upstream = http.createServer((req, res) => {
      upstreamHits++;
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ echo: JSON.parse(b || "{}"), hit: upstreamHits }));
      });
    });
    const upPort = await listen(upstream);

    // ── RECORD: agent points its base URL at the gateway; calls flow to upstream ──
    const recGw = createGateway({ mode: "record", upstream: `http://127.0.0.1:${upPort}` });
    const recPort = await listen(recGw.server);
    const r1 = await (await fetch(`http://127.0.0.1:${recPort}/v1/chat`, { method: "POST", body: JSON.stringify({ q: "a" }) })).json();
    const r2 = await (await fetch(`http://127.0.0.1:${recPort}/v1/chat`, { method: "POST", body: JSON.stringify({ q: "b" }) })).json();
    expect(upstreamHits).toBe(2);

    const cassette = recGw.cassette();
    expect(cassette.entry_count).toBe(2);
    expect(cassette.entries.every((e) => e.kind === "http")).toBe(true);
    expect(recomputeDigest(cassette.entries)).toBe(cassette.digest); // tamper-evident
    await close(recGw.server);

    // ── REPLAY: serve recorded responses, upstream MUST NOT be hit ──
    const repGw = createGateway({ mode: "replay", cassette });
    const repPort = await listen(repGw.server);
    upstreamHits = 0;
    const rr1 = await (await fetch(`http://127.0.0.1:${repPort}/v1/chat`, { method: "POST", body: JSON.stringify({ q: "a" }) })).json();
    const rr2 = await (await fetch(`http://127.0.0.1:${repPort}/v1/chat`, { method: "POST", body: JSON.stringify({ q: "b" }) })).json();
    expect(upstreamHits).toBe(0); // ← zero upstream calls on replay (offline)
    expect(rr1).toEqual(r1);
    expect(rr2).toEqual(r2);
    expect(repGw.divergences().length).toBe(0);

    // ── GATE: a request the agent never made before → divergence (CI fails) ──
    const div = await fetch(`http://127.0.0.1:${repPort}/v1/chat`, { method: "POST", body: JSON.stringify({ q: "NEW-BEHAVIOUR" }) });
    expect(div.status).toBe(409);
    expect(repGw.divergences().length).toBe(1);

    await close(repGw.server);
    await close(upstream);
  });

  it("opt-in redaction scrubs secrets, captures full headers, and canonicalizes query order", async () => {
    const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json", "x-custom": "keep-me", "x-secret": SECRET });
      res.end(JSON.stringify({ token: SECRET, ok: true }));
    });
    const upPort = await listen(upstream);

    // RECORD with redaction on, query params in b,a order.
    const rec = createGateway({ mode: "record", upstream: `http://127.0.0.1:${upPort}`, redact: "standard" });
    const recPort = await listen(rec.server);
    await fetch(`http://127.0.0.1:${recPort}/v1/x?b=2&a=1`, { method: "POST", body: "{}" });
    const cassette = rec.cassette();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = cassette.entries[0].output as any;

    // Secret scrubbed in the stored body AND header value (not left verbatim in the cassette).
    expect(out.bodyText).not.toContain(SECRET);
    expect(out.bodyText).toContain("[redacted");
    expect(out.headers["x-secret"]).toContain("[redacted");
    // Full (non-volatile) headers are captured, not just content-type.
    expect(out.headers["x-custom"]).toBe("keep-me");
    await close(rec.server);

    // REPLAY with the query params in the OTHER order (a,b) — canonicalization → HIT.
    const rep = createGateway({ mode: "replay", cassette });
    const repPort = await listen(rep.server);
    const hit = await fetch(`http://127.0.0.1:${repPort}/v1/x?a=1&b=2`, { method: "POST", body: "{}" });
    expect(hit.status).toBe(200);
    expect(rep.divergences().length).toBe(0); // reordered query still matched
    await close(rep.server);
    await close(upstream);
  });

  it("swaps in the real upstream credential and never forwards the caller's own", async () => {
    const REAL_KEY = "Bearer sk-real-upstream-secret";
    const CALLER_KEY = "Bearer sk-caller-supplied-should-never-reach-upstream";
    let seenAuth: string | undefined;
    const upstream = http.createServer((req, res) => {
      seenAuth = req.headers["authorization"] as string | undefined;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const upPort = await listen(upstream);

    const gw = createGateway({
      mode: "record",
      upstream: `http://127.0.0.1:${upPort}`,
      upstreamAuth: { header: "authorization", value: REAL_KEY },
    });
    const port = await listen(gw.server);
    const res = await fetch(`http://127.0.0.1:${port}/v1/x`, {
      method: "POST",
      headers: { authorization: CALLER_KEY },
      body: "{}",
    });
    expect(res.status).toBe(200);
    // The real credential reached upstream...
    expect(seenAuth).toBe(REAL_KEY);
    // ...and the caller's own value was dropped, not merged or logged through.
    expect(seenAuth).not.toBe(CALLER_KEY);
    await close(gw.server);
    await close(upstream);
  });

  it("rejects requests without a valid gateway token when one is configured", async () => {
    const upstream = http.createServer((_req, res) => { res.writeHead(200); res.end("{}"); });
    const upPort = await listen(upstream);
    const gw = createGateway({ mode: "record", upstream: `http://127.0.0.1:${upPort}`, authToken: "correct-token" });
    const port = await listen(gw.server);

    const noAuth = await fetch(`http://127.0.0.1:${port}/v1/x`, { method: "POST", body: "{}" });
    expect(noAuth.status).toBe(401);

    const wrongAuth = await fetch(`http://127.0.0.1:${port}/v1/x`, {
      method: "POST", headers: { authorization: "Bearer wrong-token" }, body: "{}",
    });
    expect(wrongAuth.status).toBe(401);

    const rightAuth = await fetch(`http://127.0.0.1:${port}/v1/x`, {
      method: "POST", headers: { authorization: "Bearer correct-token" }, body: "{}",
    });
    expect(rightAuth.status).toBe(200);

    await close(gw.server);
    await close(upstream);
  });

  it("onEntry fires synchronously after each capture, BEFORE the response reaches the agent — crash durability", async () => {
    // Captured interactions used to live only in memory, flushed to disk
    // solely on a graceful SIGINT/SIGTERM (see bin/gateway.ts). A crash lost
    // everything since the last clean exit. onEntry is what the CLI hooks to
    // persist incrementally instead — this proves the hook actually fires
    // per-entry with the accumulated cassette, not just once at the end.
    const upstream = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
    const upPort = await listen(upstream);

    const persisted: number[] = [];
    const gw = createGateway({
      mode: "record",
      upstream: `http://127.0.0.1:${upPort}`,
      onEntry: (_entry, cassette) => { persisted.push(cassette.entry_count); },
    });
    const port = await listen(gw.server);

    await fetch(`http://127.0.0.1:${port}/v1/a`, { method: "POST", body: "{}" });
    // If the process had died right here, entry_count 1 was already durable.
    expect(persisted).toEqual([1]);

    await fetch(`http://127.0.0.1:${port}/v1/b`, { method: "POST", body: "{}" });
    expect(persisted).toEqual([1, 2]);

    await close(gw.server);
    await close(upstream);
  });

  it("a throwing onEntry hook never breaks capture or the response to the agent", async () => {
    const upstream = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
    const upPort = await listen(upstream);
    const gw = createGateway({
      mode: "record",
      upstream: `http://127.0.0.1:${upPort}`,
      onEntry: () => { throw new Error("disk full"); },
    });
    const port = await listen(gw.server);

    const res = await fetch(`http://127.0.0.1:${port}/v1/a`, { method: "POST", body: "{}" });
    expect(res.status).toBe(200); // agent still gets its response
    expect(gw.cassette().entry_count).toBe(1); // capture still happened in memory

    await close(gw.server);
    await close(upstream);
  });
});
