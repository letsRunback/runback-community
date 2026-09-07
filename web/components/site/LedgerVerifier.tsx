"use client";

import { useRef, useState } from "react";
import type { AuditRecord } from "@/lib/audit";

/**
 * Independent verifier for a Runback audit record.
 *
 * Every verdict on this page comes from POST /api/audit/verify — the same
 * endpoint and the same verifyAuditRecord() the CLI (@runback/verify) uses.
 * Nothing here decides validity on its own. The page's entire claim is that a
 * third party can check a record without trusting us, so a verdict this
 * component invented would be worse than no page at all.
 *
 * The per-entry animation is cosmetic — a paced reveal of a result the server
 * already returned — never the source of the result.
 */

type ES = "pending" | "checking" | "ok" | "fail";

// Import the server's own result type rather than restating it. This was a
// hand-copied duplicate, so when lib/audit.ts gained a new signature verdict
// nothing here failed to compile — the UI would simply have rendered
// `undefined` for it. `import type` is erased at build time, so pulling from a
// module that uses node:crypto is safe in a client component.
import type { VerifyResult } from "@/lib/audit";

type Checks = VerifyResult["checks"];
type VerifyResponse = VerifyResult;

/** One row in the chain display, derived from the record actually verified. */
interface Entry {
  summary: string;
  hash: string;
  prev: string;
}

const SHORT = (h: string) => (h.length > 10 ? h.slice(0, 8) : h);

/** Describe an event compactly for the chain display. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarize(e: any): string {
  switch (e?.type) {
    case "llm": {
      const tok = e.usage?.total_tokens;
      const model = e.model?.model_id ?? "model";
      return `agent thinks · ${tok ? `${tok} tok · ` : ""}${model}`;
    }
    case "tool":
      return `${e.tool_name ?? "tool"} · ${e.latency_ms ?? "?"}ms · ${
        e.policy_block ? "✗ policy gate blocked" : e.error ? "✗ error" : "ok"
      }`;
    case "run":
      return e.phase === "start" ? "run started" : `run ended · ${e.status ?? "?"}`;
    case "reasoning":
      return "reasoning";
    case "env":
      return `env · ${e.kind ?? "?"}`;
    default:
      return e?.type ?? "event";
  }
}

function toEntries(record: AuditRecord): Entry[] {
  const events = Array.isArray(record?.events) ? record.events : [];
  return events.map((e, i) => ({
    summary: summarize(e),
    hash: SHORT(e._hash ?? ""),
    // The chain is h_i = SHA-256(h_{i-1} + canonical(event_i)); entry 0's
    // predecessor is the empty string, shown as "genesis".
    prev: i === 0 ? "genesis" : SHORT(events[i - 1]._hash ?? ""),
  }));
}

const SIGNATURE_LABEL: Record<Checks["signature"], string> = {
  valid: "signature valid — signed by Runback's published Ed25519 key",
  // Sound signature, unrecognised signer. Says so plainly rather than implying
  // Runback vouched for it — a self-hosted record lands here legitimately, and
  // so would a forgery re-signed with an attacker's own keypair.
  "valid-unpinned":
    "signature is cryptographically sound, but not from Runback's published key (expected for self-hosted records)",
  invalid: "signature INVALID — does not match this record",
  unsigned: "record is unsigned (integrity verified, origin not proven)",
  "no-key": "signed with a symmetric key — not independently checkable",
};

export default function LedgerVerifier({ demoRecord }: { demoRecord: AuditRecord }) {
  const [tab, setTab] = useState<"demo" | "paste">("demo");
  const [pasted, setPasted] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [states, setStates] = useState<ES[]>([]);
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  /** Reveal the server's per-entry result at a readable pace. */
  const reveal = (rows: Entry[], chainOk: boolean, onDone: () => void) => {
    const step = rows.length > 12 ? 90 : 680;
    rows.forEach((_, i) => {
      timers.current.push(
        setTimeout(() => setStates((p) => { const n = [...p]; n[i] = "checking"; return n; }), i * step)
      );
      timers.current.push(
        setTimeout(() => {
          // A broken chain invalidates from its first divergence onward; the
          // server returns a single boolean, so mark every row failed rather
          // than guessing which one broke.
          setStates((p) => { const n = [...p]; n[i] = chainOk ? "ok" : "fail"; return n; });
          if (i === rows.length - 1) timers.current.push(setTimeout(onDone, 420));
        }, i * step + 500)
      );
    });
  };

  async function verify() {
    clearTimers();
    setResult(null);
    setError(null);
    setStates([]);
    setEntries([]);

    let record: AuditRecord;
    if (tab === "demo") {
      record = demoRecord;
    } else {
      const text = pasted.trim();
      if (!text) {
        setError("Paste a Runback audit record (the JSON from “⤓ Audit record” on any run) to verify it.");
        return;
      }
      try {
        record = JSON.parse(text) as AuditRecord;
      } catch {
        setError("That isn’t valid JSON, so there is nothing to verify. Paste the full audit record file.");
        return;
      }
      if (!record?.manifest || !Array.isArray(record.events)) {
        setError(
          "That JSON isn’t a Runback audit record — it needs a `manifest` and an `events` array. Download one with “⤓ Audit record” on any run."
        );
        return;
      }
    }

    setRunning(true);
    let data: VerifyResponse;
    try {
      const res = await fetch("/api/audit/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? `Verification failed (HTTP ${res.status}).`);
        setRunning(false);
        return;
      }
      data = body as VerifyResponse;
    } catch {
      setError("Could not reach the verifier. Check your connection and try again.");
      setRunning(false);
      return;
    }

    const rows = toEntries(record);
    setEntries(rows);
    setStates(rows.map(() => "pending" as ES));
    if (!rows.length) {
      setResult(data);
      setRunning(false);
      return;
    }
    reveal(rows, data.checks.chain, () => {
      setResult(data);
      setRunning(false);
    });
  }

  const valid = result?.valid === true;
  // Three outcomes, because two cannot distinguish "this was altered" from
  // "this may be genuine but nothing here proves it" — and collapsing the
  // second into a green tick was the bug this component shipped with.
  const verdict = result?.verdict ?? (valid ? "valid" : "invalid");

  return (
    <div className="lv">
      <div className="lv-tabs">
        <button data-active={tab === "demo" || undefined} onClick={() => setTab("demo")}>
          Use demo record
        </button>
        <button data-active={tab === "paste" || undefined} onClick={() => setTab("paste")}>
          Paste your export
        </button>
      </div>

      {tab === "demo" ? (
        <pre className="lv-export">{JSON.stringify(demoRecord, null, 2)}</pre>
      ) : (
        <textarea
          className="lv-paste"
          placeholder={"Paste a Runback audit export (JSON) here…"}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
        />
      )}

      <button className="btn-fill lv-btn" onClick={verify} disabled={running}>
        {running ? "Verifying…" : "Verify chain →"}
      </button>

      {error && (
        <div className="lv-verdict" data-v="tampered">
          <span className="lv-vg">!</span>
          <div>
            <strong>Nothing verified.</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {states.length > 0 && (
        <div className="lv-chain">
          {entries.map((e, i) => (
            <div key={i} className="lv-entry" data-state={states[i]}>
              <span className="lv-glyph mono">
                {states[i] === "pending" ? "·"
                  : states[i] === "checking" ? "…"
                  : states[i] === "ok" ? "✓"
                  : "✗"}
              </span>
              <div className="lv-info">
                <span className="lv-sum">{e.summary}</span>
                <span className="lv-hashes mono">
                  hash <strong>{e.hash}</strong> ← prev <strong>{e.prev}</strong>
                </span>
              </div>
              <span className="lv-state mono">
                {states[i] === "ok" ? "chain intact"
                  : states[i] === "fail" ? "chain broken"
                  : states[i]}
              </span>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="lv-verdict" data-v={verdict === "valid" ? "valid" : verdict === "unverified" ? "unverified" : "tampered"}>
          <span className="lv-vg">{verdict === "valid" ? "✓" : verdict === "unverified" ? "~" : "✗"}</span>
          <div>
            <strong>
              {verdict === "valid" ? "Record is valid."
                : verdict === "unverified" ? "Integrity holds — but this record's origin is unproven."
                : "Verification failed — this record is not intact."}
            </strong>
            <p>
              {verdict === "valid" ? (
                <>
                  All {entries.length} entries chain correctly and the content digest matches the
                  terminal chain hash. The recorded oracle stream reproduces the sealed cassette
                  digest, so the record is re-executable, not just readable — and you checked that
                  without Runback installed.
                </>
              ) : verdict === "unverified" ? (
                <>
                  Every integrity check passed: the entries chain correctly and the digests match.
                  That shows the file is self-consistent — but the chain algorithm is{" "}
                  <a href="/spec" className="mk-link">published</a>, so a self-consistent record can
                  be authored by anyone, or edited and re-chained.{" "}
                  {result.checks.signature === "unsigned"
                    ? "This record carries no signature at all."
                    : result.checks.signature === "valid-unpinned"
                    ? "It is signed, but by a key that travelled inside the record itself — which proves only that whoever wrote it also held a keypair."
                    : "Its signature uses a symmetric key, so only the secret-holder can check it."}{" "}
                  Treat it as unverified evidence until you check the signature against a key you
                  obtained independently.
                </>
              ) : (
                <>
                  {result.checks.schema === false && "This file does not declare a Runback record schema, so it was never a cassette this verifier can vouch for. "}
                  {result.checks.consistent === false && "The record's summary — its run id or outcome — does not match its own signed events. The events are the signed truth; a summary that contradicts them means the record misrepresents what happened. "}
                  {!result.checks.chain && "The event hash chain is broken — an event was altered, inserted, or removed after sealing. "}
                  {result.checks.chain && !result.checks.digest && "The event chain is intact, but the manifest's content digest does not match it. "}
                  {result.checks.chain && result.checks.digest && !result.checks.cassette && "The event chain is intact, but the oracle stream no longer reproduces the sealed cassette digest — the recording is not the run's deterministic input stream. "}
                  {result.checks.signature === "invalid" && "The signature does not match this record. "}
                  Do not rely on this record as evidence.
                </>
              )}
            </p>
            <p className="mono" style={{ marginTop: "0.55rem", fontSize: "0.72rem" }}>
              summary {result.checks.consistent ? "✓" : "✗"} · chain {result.checks.chain ? "✓" : "✗"} · digest {result.checks.digest ? "✓" : "✗"} ·
              cassette {result.checks.cassette ? "✓" : "✗"} · {SIGNATURE_LABEL[result.checks.signature]}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
