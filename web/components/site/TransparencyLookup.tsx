"use client";

import { useState } from "react";

interface LookupResult {
  count: number;
  chain_ok: boolean | null;
  chain_note?: string;
  entries: { seq: number; ckpt_seq: number; head_hash: string; merkle_root: string; published_at: string }[];
}

const LOG_ID_RE = /^rbl_[a-f0-9]{24}$/;

function short(h: string): string {
  return `${h.slice(0, 16)}…`;
}

export default function TransparencyLookup() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ok"; data: LookupResult }
  >({ status: "idle" });

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const id = input.trim();
    if (!LOG_ID_RE.test(id)) {
      setState({ status: "error", message: `Not a Runback log id — expected the form rbl_ followed by 24 hex characters (e.g. from a workspace's Audit ledger page or badge embed).` });
      return;
    }
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/transparency?log=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const data = (await res.json()) as LookupResult;
      setState({ status: "ok", data });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "lookup failed" });
    }
  }

  return (
    <div className="transparency-lookup">
      <form onSubmit={lookup} className="transparency-lookup-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="rbl_… (paste a log id from a badge or the Audit ledger page)"
          className="transparency-lookup-input mono"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        <button type="submit" className="btn-fill" disabled={state.status === "loading"}>
          {state.status === "loading" ? "Checking…" : "Check"}
        </button>
      </form>

      {state.status === "error" && <p className="transparency-lookup-error">{state.message}</p>}

      {state.status === "ok" && (
        <div className="transparency-lookup-result">
          {state.data.count === 0 ? (
            <p>No entries published for this log id yet.</p>
          ) : (
            <>
              <p>
                <strong>{state.data.count.toLocaleString()}</strong> checkpoint{state.data.count === 1 ? "" : "s"} published
                for this workspace.
              </p>
              <table className="ptab ptab-prose">
                <thead>
                  <tr><th>Feed seq</th><th>Checkpoint</th><th>Head hash</th><th>Merkle root</th><th>Published</th></tr>
                </thead>
                <tbody>
                  {state.data.entries.slice(-10).reverse().map((e) => (
                    <tr key={e.seq}>
                      <td className="mono">{e.seq}</td>
                      <td className="mono">{e.ckpt_seq}</td>
                      <td className="mono" title={e.head_hash}>{short(e.head_hash)}</td>
                      <td className="mono" title={e.merkle_root}>{short(e.merkle_root)}</td>
                      <td>{new Date(e.published_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {state.data.chain_note && <p className="transparency-lookup-note">{state.data.chain_note}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
