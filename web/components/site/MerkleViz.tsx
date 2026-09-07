"use client";

import { useState } from "react";

// Design-token colors, referenced by var() rather than duplicated as hex —
// these are plain CSS strings inside React inline `style` objects, which
// (unlike canvas fillStyle) accept var(--token) directly.
const c = {
  blue:    "var(--blue)",
  violet:  "var(--violet)",
  emerald: "var(--emerald)",
  muted:   "rgba(255,255,255,0.28)",
  dim:     "rgba(255,255,255,0.45)",
  border:  "rgba(255,255,255,0.08)",
};

const LEAVES = [
  { id: "leaf_0", label: "loan-approval-agent",     seq: 0, hash: "c4a1f8e2b3d5" },
  { id: "leaf_1", label: "credit-check-agent",       seq: 1, hash: "7f2e9d1b4a6c" },
  { id: "leaf_2", label: "fraud-detection-agent",    seq: 2, hash: "e8b3c5d0f2a4" },
  { id: "leaf_3", label: "payment-processor-agent",  seq: 3, hash: "1a9f4e7c2b8d" },
];
const NODE_01 = { id: "node_01", label: "node_01", hash: "3b6d9e0f1c4a" };
const NODE_23 = { id: "node_23", label: "node_23", hash: "a2c5f8b1e4d7" };
const ROOT    = { id: "root",    label: "merkle_root", hash: "5e1a8c3f6b9d" };

const PROOF_PATHS: Record<number, { nodeId: string; side: "left" | "right"; hash: string }[]> = {
  0: [{ nodeId: "leaf_1", side: "right", hash: "7f2e9d1b4a6c" }, { nodeId: "node_23", side: "right", hash: "a2c5f8b1e4d7" }],
  1: [{ nodeId: "leaf_0", side: "left",  hash: "c4a1f8e2b3d5" }, { nodeId: "node_23", side: "right", hash: "a2c5f8b1e4d7" }],
  2: [{ nodeId: "leaf_3", side: "right", hash: "1a9f4e7c2b8d" }, { nodeId: "node_01", side: "left",  hash: "3b6d9e0f1c4a" }],
  3: [{ nodeId: "leaf_2", side: "left",  hash: "e8b3c5d0f2a4" }, { nodeId: "node_01", side: "left",  hash: "3b6d9e0f1c4a" }],
};

const PROOF_STEPS: Record<number, { step: string; formula: string; result: string }[]> = {
  0: [
    { step: "1", formula: 'SHA256("node:" + c4a1… + 7f2e…)', result: "3b6d9e0f1c4a…" },
    { step: "2", formula: 'SHA256("node:" + 3b6d… + a2c5…)', result: "5e1a8c3f6b9d…" },
  ],
  1: [
    { step: "1", formula: 'SHA256("node:" + c4a1… + 7f2e…)', result: "3b6d9e0f1c4a…" },
    { step: "2", formula: 'SHA256("node:" + 3b6d… + a2c5…)', result: "5e1a8c3f6b9d…" },
  ],
  2: [
    { step: "1", formula: 'SHA256("node:" + e8b3… + 1a9f…)', result: "a2c5f8b1e4d7…" },
    { step: "2", formula: 'SHA256("node:" + 3b6d… + a2c5…)', result: "5e1a8c3f6b9d…" },
  ],
  3: [
    { step: "1", formula: 'SHA256("node:" + e8b3… + 1a9f…)', result: "a2c5f8b1e4d7…" },
    { step: "2", formula: 'SHA256("node:" + 3b6d… + a2c5…)', result: "5e1a8c3f6b9d…" },
  ],
};

function nodeInProof(nodeId: string, selected: number | null) {
  if (selected === null) return false;
  if (nodeId === LEAVES[selected].id || nodeId === "root") return true;
  return PROOF_PATHS[selected].some((p) => p.nodeId === nodeId);
}

function NodeBox({
  label, hash, tone, onClick, selected, small,
}: {
  label: string; hash: string; tone: "violet" | "blue" | "emerald" | "dim";
  onClick?: () => void; selected?: boolean; small?: boolean;
}) {
  const colors: Record<string, string> = { violet: c.violet, blue: c.blue, emerald: c.emerald, dim: c.muted };
  const bgs:    Record<string, string> = { violet: "rgba(124,92,252,0.08)", blue: "rgba(79,156,249,0.06)", emerald: "rgba(34,197,94,0.08)", dim: "rgba(255,255,255,0.03)" };
  const borders: Record<string, string> = { violet: "rgba(124,92,252,0.3)", blue: "rgba(79,156,249,0.2)", emerald: "rgba(34,197,94,0.3)", dim: c.border };

  const active = tone === "emerald";
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? "rgba(34,197,94,0.1)" : bgs[tone],
        border: `1px solid ${active ? "rgba(34,197,94,0.4)" : borders[tone]}`,
        borderRadius: 8,
        padding: small ? "0.38rem 0.6rem" : "0.55rem 0.9rem",
        fontFamily: "var(--font-mono)",
        fontSize: small ? "0.68rem" : "0.74rem",
        color: colors[tone],
        textAlign: "center",
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
        transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
        boxShadow: selected ? `0 0 0 2px ${c.emerald}` : active ? `0 0 12px rgba(34,197,94,0.2)` : "none",
        minWidth: small ? 80 : 120,
        outline: "none",
      }}
    >
      <div style={{ fontWeight: 600, letterSpacing: "0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>{label}</div>
      <div style={{ fontSize: "0.62rem", color: "rgba(255,255,255,0.22)", marginTop: "0.2rem" }}>{hash}…</div>
    </div>
  );
}

// Vertical connector segment
function Connector({ highlight }: { highlight?: boolean }) {
  return (
    <div style={{ width: 1, height: 18, background: highlight ? c.emerald : "rgba(255,255,255,0.1)", margin: "0 auto", transition: "background 0.2s" }} />
  );
}

// Horizontal bar with two drop arms
function HBar({ leftHighlight, rightHighlight }: { leftHighlight?: boolean; rightHighlight?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 0, position: "relative", height: 22, width: "100%" }}>
      {/* left arm */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: "50%", height: 1, background: leftHighlight ? c.emerald : "rgba(255,255,255,0.1)", alignSelf: "flex-end", transition: "background 0.2s" }} />
        <div style={{ width: 1, height: 21, background: leftHighlight ? c.emerald : "rgba(255,255,255,0.1)", transition: "background 0.2s" }} />
      </div>
      {/* right arm */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: "50%", height: 1, background: rightHighlight ? c.emerald : "rgba(255,255,255,0.1)", alignSelf: "flex-start", transition: "background 0.2s" }} />
        <div style={{ width: 1, height: 21, background: rightHighlight ? c.emerald : "rgba(255,255,255,0.1)", transition: "background 0.2s" }} />
      </div>
    </div>
  );
}

// 4-arm branching connector
function HBar4({
  hl, hr,   // node_01 children highlights
  hl2, hr2, // node_23 children highlights
}: { hl?: boolean; hr?: boolean; hl2?: boolean; hr2?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", width: "100%", height: 22 }}>
      {/* leaf 0 arm (left of node_01) */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: "100%", height: 1, background: hl ? c.emerald : "rgba(255,255,255,0.1)", transition: "background 0.2s" }} />
        <div style={{ width: 1, flex: 1, background: hl ? c.emerald : "rgba(255,255,255,0.1)", transition: "background 0.2s" }} />
      </div>
      {/* leaf 1 arm (right of node_01) */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: "100%", height: 1, background: hr ? c.emerald : "rgba(255,255,255,0.1)", transition: "background 0.2s" }} />
        <div style={{ width: 1, flex: 1, background: hr ? c.emerald : "rgba(255,255,255,0.1)", transition: "background 0.2s" }} />
      </div>
      {/* leaf 2 arm (left of node_23) */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: "100%", height: 1, background: hl2 ? c.emerald : "rgba(255,255,255,0.1)", transition: "background 0.2s" }} />
        <div style={{ width: 1, flex: 1, background: hl2 ? c.emerald : "rgba(255,255,255,0.1)", transition: "background 0.2s" }} />
      </div>
      {/* leaf 3 arm (right of node_23) */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: "100%", height: 1, background: hr2 ? c.emerald : "rgba(255,255,255,0.1)", transition: "background 0.2s" }} />
        <div style={{ width: 1, flex: 1, background: hr2 ? c.emerald : "rgba(255,255,255,0.1)", transition: "background 0.2s" }} />
      </div>
    </div>
  );
}

export default function MerkleViz() {
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<"tree" | "proof">("tree");
  const [verified, setVerified] = useState(false);

  const sel = selected;
  const inPath = (id: string) => nodeInProof(id, sel);

  function selectLeaf(i: number) {
    setSelected(i);
    setTab("tree");
    setVerified(false);
  }

  // Which connectors are on the proof path?
  // root→node_01 highlighted if sel ∈ {0,1}, root→node_23 if sel ∈ {2,3}
  const rootToLeft  = sel !== null && (sel === 0 || sel === 1);
  const rootToRight = sel !== null && (sel === 2 || sel === 3);
  // node_01→leaf_0 if sel=0, node_01→leaf_1 if sel=1
  const n01ToL0 = sel === 0;
  const n01ToL1 = sel === 1;
  // node_23→leaf_2 if sel=2, node_23→leaf_3 if sel=3
  const n23ToL2 = sel === 2;
  const n23ToL3 = sel === 3;

  const proofSteps = sel !== null ? PROOF_STEPS[sel] : [];
  const proofPath  = sel !== null ? PROOF_PATHS[sel] : [];

  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 12, overflow: "hidden", background: "var(--bg-base)" }}>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.35rem", padding: "0.75rem 1rem 0" }}>
        {(["tree", "proof"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); if (t === "proof") setVerified(false); }}
            style={{
              fontFamily: "var(--font-mono)", fontSize: "0.74rem",
              background: tab === t ? "rgba(79,156,249,0.1)" : "transparent",
              border: `1px solid ${tab === t ? c.blue : c.border}`,
              borderRadius: 6, padding: "0.28rem 0.75rem",
              color: tab === t ? c.blue : c.muted,
              cursor: "pointer", transition: "all 0.12s",
            }}
          >
            {t === "tree" ? "Tree view" : "Proof path"}
          </button>
        ))}
      </div>

      {/* ── Tree view ── */}
      {tab === "tree" && (
        <div style={{ padding: "1.2rem 1rem 1rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 0, overflowX: "auto" }}>

          {/* Was buried below the diagram as small muted print — a visitor
              met four unlabeled-looking boxes and jargon (leaf, node_01,
              merkle_root) before any explanation of what to do or why.
              Leading with this sentence does two things at once: says what a
              leaf is in plain terms, and states the click affordance up front
              instead of hoping someone scrolls past the tree to find it. */}
          <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.65)", textAlign: "center", maxWidth: "42ch", margin: "0 0 1.1rem", lineHeight: 1.5 }}>
            Each leaf below is one sealed run. <strong style={{ color: c.blue }}>Click one</strong> to see the
            minimal set of hashes that proves it belongs to the signed root — without exposing anything about the other three.
          </p>

          {/* Root */}
          <NodeBox label={ROOT.label} hash={ROOT.hash} tone={inPath("root") ? "emerald" : "violet"} />
          <Connector highlight={rootToLeft || rootToRight} />

          {/* Mid row */}
          <HBar leftHighlight={rootToLeft} rightHighlight={rootToRight} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <NodeBox label={NODE_01.label} hash={NODE_01.hash} tone={inPath("node_01") ? "emerald" : "dim"} small />
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <NodeBox label={NODE_23.label} hash={NODE_23.hash} tone={inPath("node_23") ? "emerald" : "dim"} small />
            </div>
          </div>

          {/* Leaf connectors */}
          <HBar4 hl={n01ToL0} hr={n01ToL1} hl2={n23ToL2} hr2={n23ToL3} />

          {/* Leaves */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", width: "100%" }}>
            {LEAVES.map((leaf, i) => {
              const active = sel === i;
              const onPath = inPath(leaf.id);
              return (
                <button
                  key={leaf.id}
                  onClick={() => selectLeaf(i)}
                  style={{
                    all: "unset",
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: "0.2rem", padding: "0.55rem 0.4rem",
                    background: active ? "rgba(34,197,94,0.1)" : onPath ? "rgba(34,197,94,0.05)" : "rgba(79,156,249,0.04)",
                    border: `1px solid ${active ? "rgba(34,197,94,0.5)" : onPath ? "rgba(34,197,94,0.25)" : "rgba(79,156,249,0.18)"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    boxShadow: active ? "0 0 0 2px rgba(34,197,94,0.3)" : "none",
                    textAlign: "center",
                    minHeight: 72,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>leaf:</span>
                  {/* break-word (not break-all): these labels are hyphenated
                      agent names ("payment-processor-agent") — break-all was
                      splitting mid-word ("...processor-agen" / "t") on the
                      longest label instead of wrapping at the hyphen. */}
                  <span style={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)", color: active ? c.emerald : c.blue, fontWeight: 600, lineHeight: 1.3, wordBreak: "break-word" }}>{leaf.label}</span>
                  <span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", color: c.muted }}>seq={leaf.seq}</span>
                  <span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.2)" }}>{leaf.hash}…</span>
                </button>
              );
            })}
          </div>

          {/* Inline proof summary on selection */}
          {sel !== null && (
            <div style={{
              marginTop: "1rem", width: "100%",
              background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.15)",
              borderRadius: 8, padding: "0.75rem 1rem",
            }}>
              <div style={{ fontSize: "0.72rem", color: c.emerald, fontFamily: "var(--font-mono)", marginBottom: "0.5rem", letterSpacing: "0.04em" }}>
                PROOF PATH — {LEAVES[sel].label} · {proofPath.length} siblings needed
              </div>
              {proofPath.map((p, i) => (
                <div key={i} style={{ display: "flex", gap: "0.6rem", fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: c.muted, marginBottom: "0.2rem" }}>
                  <span style={{ color: c.emerald, minWidth: 36 }}>{p.side}</span>
                  <span>{p.hash}…</span>
                </div>
              ))}
              <button
                onClick={() => { setTab("proof"); setVerified(false); }}
                style={{
                  all: "unset", marginTop: "0.6rem", fontSize: "0.72rem",
                  fontFamily: "var(--font-mono)", color: c.blue, cursor: "pointer",
                  borderBottom: `1px solid ${c.blue}`, paddingBottom: "0.05rem",
                }}
              >
                Verify proof →
              </button>
            </div>
          )}

        </div>
      )}

      {/* ── Proof view ── */}
      {tab === "proof" && (
        <div style={{ padding: "1rem 1.2rem 1.2rem" }}>
          {sel === null ? (
            <p style={{ fontSize: "0.82rem", color: c.muted, fontFamily: "var(--font-mono)", padding: "1rem 0" }}>
              Select a leaf in Tree view first.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem" }}>
                <span style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.7)" }}>
                  Proof for <strong style={{ color: c.emerald }}>{LEAVES[sel].label}</strong>
                </span>
                <span style={{ fontSize: "0.66rem", fontFamily: "var(--font-mono)", color: c.muted }}>SHA256(&quot;node:&quot; + a + b)</span>
              </div>

              {/* Leaf */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.7rem", background: "rgba(79,156,249,0.06)", border: "1px solid rgba(79,156,249,0.18)", borderRadius: 7, marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>leaf</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: c.blue }}>{LEAVES[sel].hash}…</span>
                <span style={{ fontSize: "0.66rem", color: c.muted, marginLeft: "auto" }}>sha256(&quot;leaf:&quot; + canonical(run_attrs))</span>
              </div>

              {/* Steps */}
              {proofSteps.map((s, i) => (
                <div key={i} style={{
                  display: "flex", flexDirection: "column", gap: "0.25rem",
                  padding: "0.55rem 0.7rem", marginBottom: "0.4rem",
                  background: verified ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${verified ? "rgba(34,197,94,0.2)" : c.border}`,
                  borderRadius: 7, transition: "all 0.25s",
                }}>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <span style={{ fontSize: "0.62rem", fontFamily: "var(--font-mono)", color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 40 }}>step {s.step}</span>
                    <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "rgba(255,255,255,0.55)" }}>{s.formula}</code>
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <span style={{ fontSize: "0.62rem", color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "var(--font-mono)", minWidth: 40 }}>= </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: verified ? c.emerald : c.blue }}>{s.result}</span>
                  </div>
                </div>
              ))}

              {/* Conclusion */}
              <div style={{
                padding: "0.55rem 0.7rem", marginBottom: "0.75rem",
                background: verified ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${verified ? "rgba(34,197,94,0.3)" : c.border}`,
                borderRadius: 7, transition: "all 0.25s",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: c.muted }}>computed root: {ROOT.hash}…</span>
                {verified && <span style={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)", color: c.emerald, fontWeight: 600 }}>✓ matches sealed root</span>}
              </div>

              <button
                onClick={() => setVerified(true)}
                disabled={verified}
                style={{
                  all: "unset", cursor: verified ? "default" : "pointer",
                  display: "inline-block", padding: "0.5rem 1.1rem",
                  background: verified ? "rgba(34,197,94,0.12)" : "rgba(79,156,249,0.12)",
                  border: `1px solid ${verified ? "rgba(34,197,94,0.3)" : "rgba(79,156,249,0.25)"}`,
                  borderRadius: 7, fontFamily: "var(--font-mono)", fontSize: "0.76rem",
                  color: verified ? c.emerald : c.blue, transition: "all 0.15s",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {verified ? "✓ Proof verified" : "Verify proof"}
              </button>

              {verified && (
                <p style={{ marginTop: "0.75rem", fontSize: "0.72rem", color: c.muted, lineHeight: 1.6, fontFamily: "var(--font-mono)" }}>
                  Domain separation (<code style={{ color: c.blue }}>leaf:</code> vs <code style={{ color: c.violet }}>node:</code> prefix) prevents second-preimage attacks — a valid node hash cannot be mistaken for a leaf hash.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
