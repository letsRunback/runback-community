import Link from "next/link";
import type { TrustChain, TrustEdge } from "@/lib/trust";
import { ScopeBisectPanel } from "@/components/ScopeBisectPanel";

// Same tokens as globals.css's --emerald/--amber/--rose (+ their -dim
// backgrounds) — hardcoded here only because CSS custom properties can't be
// blended inside an inline rgba() without color-mix(), not because these are
// a different palette. Previously used off-token hex (#22c55e/#eab308) that
// rendered a visibly different shade of green/yellow than every other
// success/warning badge in the app, which all use the real tokens.
const LEVEL_STYLE = {
  verified:   { color: "var(--emerald)", bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.25)", label: "✓ verified",   glyph: "✓" },
  unattested: { color: "var(--amber)",   bg: "rgba(224,138,42,0.08)", border: "rgba(224,138,42,0.25)", label: "~ unattested", glyph: "~" },
  broken:     { color: "var(--rose)",    bg: "rgba(244,63,94,0.08)",  border: "rgba(244,63,94,0.25)",  label: "✗ broken",     glyph: "✗" },
};

function short(s: string) { return `${s.slice(0, 8)}…${s.slice(-6)}`; }

function AgentNode({
  name,
  runId,
  isRoot,
}: {
  name: string;
  runId: string;
  depth: number;
  isRoot?: boolean;
}) {
  return (
    <div className={isRoot ? "tc-node tc-node--root" : "tc-node tc-node--child"}>
      <span className={isRoot ? "tc-node-dot tc-node-dot--root" : "tc-node-dot tc-node-dot--child"} />
      <span className="tc-node-name mono">
        {name}
      </span>
      {isRoot && (
        <span className="tc-node-root-label mono">root</span>
      )}
      <Link href={`/app/runs/${runId}`} className="tc-node-link mono">
        {runId.slice(0, 10)} →
      </Link>
    </div>
  );
}

function DelegationEdge({ edge }: { edge: TrustEdge }) {
  const s = LEVEL_STYLE[edge.trust_level];
  const violated = !!edge.scope_violations?.length;
  return (
    <div className="tc-edge">
      <div className="tc-edge-row">
        <div className="tc-edge-line" />
        <span className="tc-edge-label mono">
          delegates to
        </span>
        <span
          className="tc-edge-trust mono"
          style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
        >
          {s.label}
        </span>
        <span className="tc-edge-scope mono">
          scope: {edge.scope.join(", ")}
        </span>
        <span className="tc-edge-token mono">
          {edge.signature.alg === "Ed25519" ? "ed25519:" : "hmac:"}{short(edge.signature.value)}
        </span>
      </div>
      {/* Distinct from a broken signature — the chain can be perfectly
          signed and unbroken and still record a subagent that used a tool
          its declared scope never granted. Separate finding, separate row. */}
      {violated && (
        <div className="tc-edge-row tc-edge-violation">
          <div className="tc-edge-line tc-edge-line--violation" />
          <span
            className="tc-edge-trust mono"
            style={{ background: LEVEL_STYLE.broken.bg, color: LEVEL_STYLE.broken.color, border: `1px solid ${LEVEL_STYLE.broken.border}` }}
          >
            ⚠ scope violation
          </span>
          <span className="tc-edge-scope mono">
            called out of scope: {edge.scope_violations!.join(", ")}
          </span>
          <ScopeBisectPanel callingAgent={edge.calling_agent} calledAgent={edge.called_agent} />
        </div>
      )}
    </div>
  );
}

function buildChainDisplay(
  chain: TrustChain,
  rootRunId: string,
  rootName: string
) {
  const edgesByParent = new Map<string, TrustEdge[]>();
  for (const e of chain.edges) {
    if (!edgesByParent.has(e.parent_run_id)) edgesByParent.set(e.parent_run_id, []);
    edgesByParent.get(e.parent_run_id)!.push(e);
  }

  const items: React.ReactNode[] = [];

  function walk(runId: string, name: string, depth: number) {
    items.push(
      <AgentNode key={`node-${runId}`} name={name} runId={runId} depth={depth} isRoot={depth === 0} />
    );
    const children = edgesByParent.get(runId) ?? [];
    for (const edge of children) {
      items.push(<DelegationEdge key={`edge-${edge.child_run_id}`} edge={edge} />);
      walk(edge.child_run_id, edge.called_agent, depth + 1);
    }
  }

  walk(rootRunId, rootName, 0);
  return items;
}

export function TrustChainPanel({
  chain,
  rootName,
  runId,
}: {
  chain: TrustChain;
  rootName: string;
  runId: string;
}) {
  const overall = LEVEL_STYLE[chain.overall];

  return (
    <section className="audit-card tc-panel">
      <div className="audit-card-main tc-panel-main">
        <div className="audit-card-head">
          <span className="audit-card-title">Inter-agent trust chain</span>
          <span
            className="audit-badge mono"
            style={{ color: overall.color, background: overall.bg, border: `1px solid ${overall.border}` }}
          >
            {chain.agent_count} agents · depth {chain.depth} · {overall.label}
          </span>
        </div>
        <p className="audit-card-sub">
          Every delegation edge is sealed with a signed attestation — Ed25519 wherever this deployment has a keypair configured,
          the same signature the per-run audit record uses, HMAC-SHA256 fallback otherwise. Each signature includes the hash of
          its parent, forming a chain from root to leaf — independently verifiable without Runback.
        </p>

        {/* Chain visualization */}
        <div className="tc-chain-viz">
          {chain.edges.length === 0 ? (
            <div className="tc-chain-empty mono">
              Single-agent run — no delegation edges
            </div>
          ) : (
            buildChainDisplay(chain, runId, rootName)
          )}
        </div>

        {/* Chain digest summary */}
        {chain.edges.length > 0 && (
          <div className="tc-digest-grid">
            {[
              { k: "edges", v: String(chain.edges.length) },
              { k: "verified", v: String(chain.edges.filter(e => e.trust_level === "verified").length) },
              { k: "unattested", v: String(chain.edges.filter(e => e.trust_level === "unattested").length) },
              { k: "broken", v: String(chain.edges.filter(e => e.trust_level === "broken").length) },
              { k: "scope violations", v: String(chain.edges.filter(e => e.scope_violations?.length).length) },
            ].map(({ k, v }) => (
              <div key={k} className="tc-digest-item">
                <div className="tc-digest-key mono">{k}</div>
                <div className="tc-digest-val mono">{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="audit-card-actions">
        <a
          className="btn-fill"
          href={`/api/trust/chain?run_id=${runId}&download=1`}
          download={`runback-trust-chain-${runId.slice(0, 10)}.json`}
        >
          ⤓ Export trust chain
        </a>
        <span className="tc-actions-hint mono">
          POST to /api/trust/verify to re-verify
        </span>
      </div>
    </section>
  );
}
