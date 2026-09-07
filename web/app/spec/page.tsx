import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/spec",
  title: "runback.cassette/v1 — Open Audit Format for AI Agent Decisions",
  description:
    "The open format for tamper-evident, re-executable audit records of AI agent decisions. RFC 8785 canonical JSON, SHA-256 hash-chained, Ed25519-signed, independently verifiable — field-level spec.",
});

/** The one real diagram this page was missing: what "hash-chained" actually looks like. Each event's hash folds in the previous one, so altering event 2 changes its hash, which no longer matches what event 3 recorded — the break is visible at the exact point of tampering, not just "somewhere in the file." */
function ChainDiagram() {
  const events = ["Event 1", "Event 2", "Event 3", "Event 4"];
  return (
    <svg viewBox="0 0 720 140" width="100%" style={{ maxWidth: 620, height: "auto", margin: "1.6rem 0" }}>
      {events.map((label, i) => {
        const x = 20 + i * 170;
        const isLast = i === events.length - 1;
        return (
          <g key={label}>
            <rect x={x} y={30} width={130} height={56} rx={8} fill="var(--bg-surface)" stroke={isLast ? "var(--emerald)" : "var(--border-strong)"} strokeWidth={isLast ? 2 : 1} />
            <text x={x + 65} y={54} textAnchor="middle" fontSize="13" fill="var(--text-primary)" fontFamily="var(--font-plex-mono), monospace">{label}</text>
            <text x={x + 65} y={72} textAnchor="middle" fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-plex-mono), monospace">hash_{i + 1}</text>
            {!isLast && (
              <>
                <line x1={x + 130} y1={58} x2={x + 168} y2={58} stroke="var(--text-muted)" strokeWidth={1.5} />
                <polygon points={`${x + 168},58 ${x + 160},53 ${x + 160},63`} fill="var(--text-muted)" />
              </>
            )}
          </g>
        );
      })}
      <text x={360} y={16} textAnchor="middle" fontSize="11" fill="var(--text-muted)">hash_n = SHA-256(hash_n-1 + event_n) — each link folds in every link before it</text>
      <text x={360} y={130} textAnchor="middle" fontSize="11" fill="var(--emerald)">Sealed: the final hash is what gets signed and published</text>
    </svg>
  );
}

const EXAMPLE = `{
  "$schema": "runback.audit/v2",
  "manifest": {
    "run_id": "run_a3f1b90c",
    "generated_at": "2026-06-14T02:47:13.950Z",
    "event_count": 6,
    "algorithm": "sha256-chain",
    "content_digest": "8f2e1a9c4b7d3f60...",
    "replay": {
      "cassette_digest": "3c91f0a4d8b2e715...",
      "entry_count": 2,
      "algorithm": "oracle-chain/sha256",
      "note": "Recomputing this over the events must equal it — that's the replay proof."
    },
    "signed": true,
    "signature": {
      "alg": "Ed25519",
      "value": "9f3a1c7e0d5b...",
      "pubkey": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----"
    },
    "verify": "npx @runback/verify sample-cassette.json",
    "spec_url": "https://runback.dev/spec",
    "verifier_url": "https://runback.dev/verify"
  },
  "run": {
    "run_id": "run_a3f1b90c",
    "name": "loan-approval-agent",
    "status": "error",
    "started_at": "2026-06-14T02:47:11.000Z",
    "ended_at": "2026-06-14T02:47:13.950Z"
  },
  "events": [
    {
      "schema_version": 1,
      "run_id": "run_a3f1b90c",
      "span_id": "l1",
      "parent_span_id": "r",
      "seq": 1,
      "ts_start": "2026-06-14T02:47:11.000Z",
      "ts_end": "2026-06-14T02:47:12.400Z",
      "type": "llm",
      "model": { "provider": "openai", "model_id": "gpt-4o" },
      "request": { "...": "system, messages[], tools[], params" },
      "response": { "...": "text, tool_calls[], finish_reason" },
      "usage": { "input_tokens": 428, "output_tokens": 184, "total_tokens": 612 },
      "_hash": "a41f...  ← SHA-256(prev_hash + canonical(this event, _hash excluded))"
    }
  ]
}`;

const CANON = `// canonical(v) — RFC 8785-equivalent, applied before every hash:
if v === null || typeof v !== "object":  return JSON.stringify(v)
if Array.isArray(v):                     return "[" + v.map(canonical).join(",") + "]"
else (object):
  keys = Object.keys(v).sort()           // native JS .sort() — UTF-16 code-unit order
  emit each "key":canonical(value) IN THAT SORTED ORDER, comma-joined, wrapped in { }
  — properties whose value is undefined are omitted (matches JSON.stringify)
  — keys are serialised straight from the sorted array, never rebuilt into a
    fresh {} — rebuilding re-triggers V8's own key order, which hoists
    integer-like keys ("0","1","42") first regardless of sort. That single
    line is the actual difference between this and a naive "sort + stringify".

// Numbers: ECMAScript Number::toString via JSON.stringify (RFC 8785 §3.2.2.3
// is defined against this). -0 serialises as 0.
// Strings: whatever JSON.stringify escapes — no extra escaping added.
// All hashes and signatures below are lowercase hex, never base64.`;

const CHAIN = `// Event chain — web/lib/audit.ts, packages/verify/index.js
h_0 = ""                                          // empty-string seed, not sha256("")
h_i = SHA256_hex( h_{i-1} + canonical(event_i) )  // event_i with its own _hash field removed
// events are hashed in array order (not re-sorted by seq for this chain)
content_digest = h_n                              // the terminal hash; sha256("") if zero events`;

const ORACLE = `// Oracle-stream / cassette digest — packages/replay/src/{cassette,digest}.ts
// A SEPARATE chain from the event chain above — it's what makes a record
// re-executable, not just internally consistent. Events are sorted by seq
// first; "run" and "reasoning" events don't enter it.

oracleEntryOf(event):
  llm  → { kind: "llm",  key: sha256("llm:"  + model_id + ":" + canonical(request, projected)), output: response ?? {error} }
  tool → { kind: "tool", key: sha256("tool:" + tool_name + ":" + canonical(input, projected)),  output: output   ?? {error} }
  env  → { kind, key, output } directly (fetch/http/now/random/uuid/clock)

chainStep(prev, entry) = SHA256_hex( prev + canonical({ kind, key, output }) )
cassette_digest = final chainStep result, in seq order (sha256("") if no oracle entries)
entry_count     = number of oracle entries (usually < event_count — run/reasoning excluded)

// Optional per-event "key_projection: { keep?, drop? }" strips volatile fields
// (nonces, request IDs, timestamps) from the input before it's hashed into the
// key, so two semantically-identical calls key identically. Applied identically
// by the SDK, the server, and the verifier — same function, three call sites.`;

const SIGN = `// Signing — web/lib/audit.ts. Preference order: Ed25519, then HMAC-SHA256, then unsigned.
payload = content_digest + ":" + cassette_digest        // UTF-8, colon-joined hex digests

Ed25519:      crypto.sign(null, payload, privateKey)     // null digest — Ed25519 doesn't pre-hash
              signature hex-encoded; manifest.signature.pubkey carries the SPKI PEM
              public key inline, so a record verifies fully offline
HMAC-SHA256:  createHmac("sha256", key).update(payload).digest("hex")
              proves custody of a shared secret, not identity — no non-repudiation

// A rotated-out key (*_PRIVATE_KEY_PREVIOUS) still verifies records it signed.
// The published Ed25519 key: GET /.well-known/runback-audit-key.pem`;

const VERIFY_ALGO = `// Six checks, all run by @runback/verify, /api/audit/verify, and runback.dev/verify:
schema      — record.$schema ∈ { "runback.audit/v2", "runback.cassette/v1" (legacy alias) }
consistent  — manifest.run_id and the run summary agree with the signed events
              (a summary that contradicts its own events is rejected however intact the chain is)
chain       — recomputed h_i === events[i]._hash, for every i
digest      — recomputed terminal hash === manifest.content_digest
cassette    — recomputed oracle-stream digest === manifest.replay.cassette_digest
signature   — one of: unsigned · no-key · invalid · valid-unpinned · valid
              (Ed25519 sound but signed by a DIFFERENT key than this verifier
              pins → "valid-unpinned": sound maths, unproven signer)

integrity = schema && consistent && chain && digest && cassette
valid     = integrity && signature === "valid"
verdict   = !integrity || signature === "invalid" ? "invalid"
          : valid                                 ? "valid"
          :                                          "unverified"

// The chain algorithm is published, so a self-consistent record can be
// authored by anyone. "unverified" exists so CI can tell "self-consistent"
// apart from "provably from the key I pinned" instead of conflating them.`;

export default function Spec() {
  // See app/docs/page.tsx: /spec survives proxy.ts's self-host gate, so it
  // gets the trimmed self-host nav instead of a footer full of dead links.
  const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;
  return (
    <>
      <Header selfHosted={selfHosted} />
      <main className="mk" style={{ paddingTop: "3rem", paddingBottom: "2rem", minHeight: "60vh" }}>

        <span className="mk-eyebrow">Open standard</span>
        <h1 style={{ fontSize: "clamp(1.6rem,3.6vw,2.6rem)", letterSpacing: "-0.04em", margin: "0.8rem 0 0.5rem", fontFamily: "var(--font-mono)" }}>
          runback.cassette/v1
        </h1>
        <p className="mk-lead" style={{ maxWidth: "62ch" }}>
          An open, tamper-evident format for AI agent audit records — the artifact
          an auditor, a regulator, or another vendor should ask for or emit, not a
          Runback account. Every decision is hash-chained and independently
          verifiable with any standard crypto library. This page has field types,
          error codes, and byte-level detail, not just the shape — implement it in
          any language against this, then check your output against the real
          record below.
        </p>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.6rem", maxWidth: "62ch" }}>
          Naming note: <code className="mono">runback.cassette/v1</code> is this spec&apos;s
          name and the schema string accepted from older records. A record built
          today declares <code className="mono">$schema: &quot;runback.audit/v2&quot;</code> —
          both strings are accepted by every verifier below.
        </p>

        {/* Nine sections, ~3000 words — a jump nav so this reads as a
            reference to consult, not a document to scroll through linearly. */}
        <nav className="spec-toc mono" aria-label="Spec sections">
          {[
            ["#purpose", "Purpose"],
            ["#format", "Format"],
            ["#events", "Events"],
            ["#canon", "Canonicalization"],
            ["#chain", "Event chain"],
            ["#replay", "Replay proof"],
            ["#signing", "Signing"],
            ["#verification", "Verification"],
            ["#verify", "Verify"],
            ["#implement", "Implement"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="spec-toc-item">{label}</a>
          ))}
        </nav>

        {/* What it is */}
        <section id="purpose" className="mk-section" style={{ paddingTop: "2rem" }}>
          <span className="mk-eyebrow">Purpose</span>
          <h2 className="mk-h2">What it solves.</h2>
          <p style={{ color: "var(--text-secondary)", maxWidth: "60ch", lineHeight: 1.7 }}>
            AI agents make decisions that can&apos;t be rolled back — loans approved,
            refunds issued, triage routed. Logs record the outcome. They do not prove
            the reasoning or detect tampering. The cassette format captures every
            non-deterministic input the agent touched — context, tools, retrieval —
            in a hash-chained record sealed at execution. Change one event and
            verification fails. The record is re-executable: replay the agent against
            the captured inputs and the output must reproduce.
          </p>
          <ChainDiagram />
        </section>

        {/* Structure */}
        <section id="format" className="mk-section">
          <span className="mk-eyebrow">Format</span>
          <h2 className="mk-h2">Structure.</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1.2rem", maxWidth: "58ch" }}>
            A record is a JSON document with three top-level fields:{" "}
            <code className="mono" style={{ fontSize: "0.85em" }}>manifest</code> (digests,
            signature, metadata), <code className="mono" style={{ fontSize: "0.85em" }}>run</code>{" "}
            (a human-readable summary — name, status, timing), and{" "}
            <code className="mono" style={{ fontSize: "0.85em" }}>events</code> (the ordered,
            hash-chained event array — the signed source of truth the{" "}
            <code className="mono" style={{ fontSize: "0.85em" }}>run</code> summary is checked
            against, not the other way around). This is a trimmed excerpt — the full,
            real, byte-exact record is at{" "}
            <a href="/sample-cassette.json" style={{ color: "var(--brand)" }}>/sample-cassette.json</a>,
            generated by the same code path that builds a customer export.
          </p>
          <pre className="mk-code" style={{ maxWidth: 680 }}>
            <code>{EXAMPLE}</code>
          </pre>
        </section>

        {/* Event types */}
        <section id="events" className="mk-section">
          <span className="mk-eyebrow">Events</span>
          <h2 className="mk-h2">Event fields.</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1rem", maxWidth: "58ch" }}>
            Every event shares a base shape, then adds fields by{" "}
            <code className="mono" style={{ fontSize: "0.85em" }}>type</code>. Timestamps are
            ISO 8601 (millisecond precision, <code className="mono" style={{ fontSize: "0.85em" }}>Z</code>{" "}
            suffix) by convention — not enforced by the schema&apos;s runtime validation,
            which only checks non-empty string.
          </p>
          <div style={{ display: "grid", gap: "0.8rem", maxWidth: 680, marginTop: "0.4rem" }}>
            {[
              { t: "base", d: <><code className="mono">schema_version, run_id, span_id, parent_span_id, seq, ts_start, ts_end, type</code> — every event has these. <code className="mono">parent_span_id</code> is <code className="mono">null</code> for the root run span; <code className="mono">ts_end</code> is <code className="mono">null</code> while a step is in flight.</> },
              { t: "run", d: <><code className="mono">phase</code> (&quot;start&quot;|&quot;end&quot;), <code className="mono">name, input, output, status, error, metadata</code>. Two events per run — the failure or success is the <code className="mono">phase: &quot;end&quot;</code> one, checked against <code className="mono">run.status</code> by the <code className="mono">consistent</code> verifier check below.</> },
              { t: "llm", d: <><code className="mono">model: {"{ provider, model_id }"}</code> (an object, not a bare string), <code className="mono">request: {"{ system, messages[], tools[], params }"}</code>, <code className="mono">response: {"{ text, reasoning, finish_reason, tool_calls[] }"}</code>, <code className="mono">usage: {"{ input_tokens, output_tokens, total_tokens }"}</code>, <code className="mono">latency_ms, error</code>.</> },
              { t: "tool", d: <><code className="mono">tool_name, tool_call_id, input, output, latency_ms, error</code>. A blocked call adds <code className="mono">policy_block: {"{ rule, detail }"}</code> and <code className="mono">policy_evaluated: {"{ passed }"}</code>.</> },
            ].map(({ t, d }) => (
              <div key={t} style={{ display: "flex", gap: "1.2rem", alignItems: "flex-start" }}>
                <code className="mono" style={{ background: "var(--surface-2)", padding: "0.2rem 0.6rem", borderRadius: 4, fontSize: "0.82rem", whiteSpace: "nowrap", marginTop: 2 }}>{t}</code>
                <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.93rem", lineHeight: 1.6 }}>{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Canonicalization */}
        <section id="canon" className="mk-section">
          <span className="mk-eyebrow">Canonicalization</span>
          <h2 className="mk-h2">Before anything is hashed.</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1.2rem", maxWidth: "58ch" }}>
            Every hash below is computed over a canonical JSON string, not the raw
            object — otherwise two byte-identical records could digest differently
            just from key order. The algorithm is RFC 8785-equivalent, with one
            deliberate divergence from a naive implementation.
          </p>
          <pre className="mk-code" style={{ maxWidth: 680 }}>
            <code>{CANON}</code>
          </pre>
        </section>

        {/* Hash chain */}
        <section id="chain" className="mk-section">
          <span className="mk-eyebrow">Event chain</span>
          <h2 className="mk-h2">Tamper evidence.</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1.2rem", maxWidth: "58ch" }}>
            Each event is chained to the one before it. Changing any event breaks
            its hash and every hash after it — the chain is append-only by
            construction, not by policy.
          </p>
          <pre className="mk-code" style={{ maxWidth: 680 }}>
            <code>{CHAIN}</code>
          </pre>
        </section>

        {/* Oracle stream */}
        <section id="replay" className="mk-section">
          <span className="mk-eyebrow">Replay proof</span>
          <h2 className="mk-h2">What makes it re-executable, not just readable.</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1.2rem", maxWidth: "58ch" }}>
            The event chain proves the record wasn&apos;t edited. It doesn&apos;t prove the
            record IS what the agent actually saw and did — that&apos;s a second,
            independent digest over just the non-deterministic surface: every model
            call and tool call, content-addressed by its inputs.
          </p>
          <pre className="mk-code" style={{ maxWidth: 680 }}>
            <code>{ORACLE}</code>
          </pre>
        </section>

        {/* Signing */}
        <section id="signing" className="mk-section">
          <span className="mk-eyebrow">Signing</span>
          <h2 className="mk-h2">Tying a record to its producer.</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1.2rem", maxWidth: "58ch" }}>
            The chain and both digests establish only internal consistency — the
            algorithm is public, so anyone can author a self-consistent record.
            The signature is what proves who made it.
          </p>
          <pre className="mk-code" style={{ maxWidth: 680 }}>
            <code>{SIGN}</code>
          </pre>
        </section>

        {/* Integrity model */}
        <section id="verification" className="mk-section">
          <span className="mk-eyebrow">Verification</span>
          <h2 className="mk-h2">The six checks.</h2>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1.2rem", maxWidth: "58ch" }}>
            Any SHA-256 implementation can run all six. They&apos;re what{" "}
            <Link href="/verify" style={{ color: "var(--brand)" }}>runback.dev/verify</Link>,{" "}
            <code className="mono" style={{ fontSize: "0.85em" }}>@runback/verify</code>, and
            the API below all actually run — the same function, three call sites.
          </p>
          <pre className="mk-code" style={{ maxWidth: 680 }}>
            <code>{VERIFY_ALGO}</code>
          </pre>
        </section>

        {/* Verify */}
        <section id="verify" className="mk-section">
          <span className="mk-eyebrow">Verify</span>
          <h2 className="mk-h2">Verify a cassette.</h2>
          <div style={{ display: "grid", gap: "1rem", maxWidth: 680, marginTop: "0.6rem" }}>
            <div className="card" style={{ padding: "1.2rem 1.4rem" }}>
              <div className="mono" style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>Browser — no account</div>
              <p style={{ margin: "0 0 0.6rem", fontSize: "0.93rem" }}>
                Paste a record at <Link href="/verify" style={{ color: "var(--brand)" }}>runback.dev/verify</Link>,
                or load the real one at{" "}
                <a href="/sample-cassette.json" style={{ color: "var(--brand)" }}>/sample-cassette.json</a>.
                All six checks run client-side — the record never leaves your browser.
              </p>
            </div>
            <div className="card" style={{ padding: "1.2rem 1.4rem" }}>
              <div className="mono" style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>CLI / npm</div>
              <pre style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                <code>{`curl -O https://runback.dev/sample-cassette.json
npx @runback/verify sample-cassette.json [--json] [--key <hmac-key>]`}</code>
              </pre>
              <p style={{ margin: "0.6rem 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Zero runtime dependencies, pure <code className="mono">node:crypto</code>.
                Reads a file path or <code className="mono">-</code>/<code className="mono">--stdin</code>.{" "}
                <code className="mono">--key</code> is only for legacy HMAC-signed records —
                Ed25519 records carry their own public key and verify fully offline.
              </p>
              <p style={{ margin: "0.6rem 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Exit codes — three, not two, because &quot;self-consistent&quot; and &quot;provably
                genuine&quot; are different claims and CI needs to tell them apart:
              </p>
              <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.3rem" }}>
                {[
                  ["0", "VALID", "integrity holds and the signer is the pinned key"],
                  ["2", "UNVERIFIED", "self-consistent, but unsigned or signed by an unpinned key"],
                  ["1", "INVALID", "a check failed outright, or the input couldn't be parsed"],
                ].map(([code, label, note]) => (
                  <div key={code} style={{ display: "flex", gap: "0.8rem", fontSize: "0.85rem" }}>
                    <code className="mono" style={{ color: "var(--text-muted)", width: 14 }}>{code}</code>
                    <code className="mono" style={{ color: "var(--emerald)", width: 90 }}>{label}</code>
                    <span style={{ color: "var(--text-secondary)" }}>{note}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card" style={{ padding: "1.2rem 1.4rem" }}>
              <div className="mono" style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>API</div>
              <pre style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                <code>{`POST https://runback.dev/api/audit/verify
Content-Type: application/json

<record JSON, max 8 MiB>`}</code>
              </pre>
              <p style={{ margin: "0.6rem 0 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Unauthenticated by design — verifying a record must not require an
                account. <code className="mono" style={{ fontSize: "0.85em" }}>200</code>:
                the raw <code className="mono" style={{ fontSize: "0.85em" }}>
                {"{ valid, verdict, integrity, checks: { schema, consistent, chain, digest, cassette, signature }, consistencyFailures? }"}
                </code> result — nothing wrapped or renamed.
              </p>
              <div style={{ marginTop: "0.5rem", display: "grid", gap: "0.3rem" }}>
                {[
                  ["400", "invalid JSON, or valid JSON missing manifest/events"],
                  ["413", "over 8 MiB"],
                  ["429", "over 20 requests/60s from one IP — Retry-After header set"],
                ].map(([code, note]) => (
                  <div key={code} style={{ display: "flex", gap: "0.8rem", fontSize: "0.85rem" }}>
                    <code className="mono" style={{ color: "var(--rose)", width: 32 }}>{code}</code>
                    <span style={{ color: "var(--text-secondary)" }}>{note}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Implement */}
        <section id="implement" className="mk-section">
          <span className="mk-eyebrow">Implement</span>
          <h2 className="mk-h2">Use the format.</h2>
          <div style={{ display: "grid", gap: "1rem", maxWidth: 680, marginTop: "0.4rem" }}>
            {[
              {
                label: "Receiving a record",
                body: "Verify it at runback.dev/verify, POST to /api/audit/verify, or run @runback/verify. No account, no Runback dependency to check integrity — and check the verdict field, not just \"did it parse\": unverified is not the same claim as valid.",
              },
              {
                label: "Producing the format",
                body: "Implement the canonicalization, the event chain, and the oracle-stream digest exactly as specified above — all three are required for a record to pass every check, not just chain+digest. The reference implementations are @runback/verify (npm) and packages/replay + web/lib/audit.ts in the Runback source.",
              },
              {
                label: "Regulatory use",
                body: "Designed against the record-keeping obligations in EU AI Act Article 12 and APRA CPS 230 incident documentation — automatic event logging over the system's lifetime, with traceability and integrity. Whether a given deployment satisfies either is a determination for your assessor, not for us: no regulator certifies a file format. What the format supplies is the evidence that argument needs — manifest.generated_at, a signature that establishes the producer, and a chain any third party can re-derive without our software.",
              },
            ].map(({ label, body }) => (
              <div key={label} style={{ borderLeft: "2px solid var(--border-subtle)", paddingLeft: "1rem" }}>
                <div className="mono" style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>{label}</div>
                <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.93rem", lineHeight: 1.6 }}>{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mk-cta-band" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <div className="mk">
            <h2>Verify a cassette. Generate one. Build with it.</h2>
            <div className="hero-cta" style={{ justifyContent: "center" }}>
              <Link href="/verify" className="btn-fill">Verify a cassette →</Link>
              <Link href="/how-it-works" className="btn-line">How Runback generates them</Link>
            </div>

          </div>
        </section>

      </main>
      <Footer selfHosted={selfHosted} />
    </>
  );
}
