"use client";

import { useState } from "react";

const ENTRIES = [
  {
    kind: "now",
    key: "now",
    output: 1719532800000,
    hash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    prev: "0000000000000000000000000000000000000000000000000000000000000000",
  },
  {
    kind: "llm",
    key: "llm:gpt-4o:a3f8b291",
    output: { text: null, tool_calls: [{ tool_name: "check_policy", input: { amount: 85000, limit: 50000 } }] },
    hash: "f7e3c192d4a85b06e9f1234c7d8a0b5e2f4c6d8a1b3e5f7a9c2d4e6f8a0b2c4d",
    prev: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  },
  {
    kind: "tool",
    key: "tool:check_policy:c29a4f81",
    output: { allowed: false, reason: "exceeds_limit" },
    hash: "3d8e1f4a5b7c9e2f4a6b8d0e2f4a6b8d0e2f4a6b8d0e2f4a6b8d0e2f4a6b8d0e",
    prev: "f7e3c192d4a85b06e9f1234c7d8a0b5e2f4c6d8a1b3e5f7a9c2d4e6f8a0b2c4d",
  },
  {
    kind: "llm",
    key: "llm:gpt-4o:b7d1e329",
    output: { text: "Policy limit exceeded. Blocking approval.", finish_reason: "stop" },
    hash: "9c2e5f8a1d4b7e0f3c6a9d2e5f8a1d4b7e0f3c6a9d2e5f8a1d4b7e0f3c6a9d2e",
    prev: "3d8e1f4a5b7c9e2f4a6b8d0e2f4a6b8d0e2f4a6b8d0e2f4a6b8d0e2f4a6b8d0e",
  },
  {
    kind: "tool",
    key: "tool:issue_approval:BLOCKED",
    output: null,
    policy_block: { rule: "loan_limit", detail: "85000 > 50000" },
    hash: "b4d7f0a3e6c9b4d7f0a3e6c9b4d7f0a3e6c9b4d7f0a3e6c9b4d7f0a3e6c9b4d7",
    prev: "9c2e5f8a1d4b7e0f3c6a9d2e5f8a1d4b7e0f3c6a9d2e5f8a1d4b7e0f3c6a9d2e",
  },
] as const;

const KIND_COLORS: Record<string, string> = {
  tool: "#e05a2b",
  llm: "#5b6af7",
  now: "#2b9e6e",
  random: "#9b5de5",
  uuid: "#f4a261",
  fetch: "#2a9d8f",
  http: "#e9c46a",
  clock: "#457b9d",
};

export default function HashChainViz() {
  const [count, setCount] = useState(1);

  const visible = ENTRIES.slice(0, count);
  const current = visible[visible.length - 1];
  const canStep = count < ENTRIES.length;

  return (
    <div className="hc-container">
      <div className="hc-entries">
        {visible.map((entry, i) => (
          <div key={i}>
            <div className="hc-entry">
              <span className="hc-seq mono">{i}</span>
              {/* Was a solid, per-kind background with a fixed violet text
                  color inherited from the CSS default — fine for "tool"
                  (orange) but "llm"'s background (#5b6af7) sits so close in
                  hue and lightness to that same violet text (#7c5cfc) that
                  the label was nearly unreadable. Text color now always
                  matches the kind's own hue, on a dim tint of it instead of
                  a solid fill — same "dim background + solid text" contrast
                  pattern the rest of the site already uses for these badges. */}
              <span
                className="hc-kind"
                style={{
                  background: `${KIND_COLORS[entry.kind] ?? "#555"}22`,
                  color: KIND_COLORS[entry.kind] ?? "#aaa",
                  borderColor: `${KIND_COLORS[entry.kind] ?? "#555"}55`,
                }}
              >
                {entry.kind}
              </span>
              <span className="hc-key mono">{entry.key.slice(0, 8)}&hellip;</span>
              <span className="hc-hash mono">{entry.hash.slice(0, 12)}&hellip;</span>
            </div>
            {i < visible.length - 1 && (
              <div className="hc-arrow">
                <span className="mono">|</span>
                <span className="hc-arrow-label mono">chained</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="hc-digest">
        <span className="hc-digest-label">current digest</span>
        <span className="mono">{current.hash.slice(0, 24)}&hellip;</span>
      </div>

      <div className="hc-algo">
        <code>SHA256(prev_hash + canonical(&#123;kind, key, output&#125;))</code>
      </div>

      {canStep ? (
        <button className="hc-step-btn" onClick={() => setCount((c) => c + 1)}>
          Step &rarr; add entry {count}
        </button>
      ) : (
        <button className="hc-step-btn" disabled>
          Chain complete ({ENTRIES.length} entries)
        </button>
      )}
    </div>
  );
}
