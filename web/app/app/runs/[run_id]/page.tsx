import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getRun } from "@/lib/runs";
import { getAdminClient } from "@/lib/supabase/admin";
import { cassetteDigestFromEvents } from "@runback/replay";
import { determinismReport } from "@runback/replay";
import { can, featurePlan } from "@/lib/entitlements";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { buildAuditRecord } from "@/lib/audit";
import { getAgentGraph, type AgentNode } from "@/lib/multiAgent";
import { getTrustChain } from "@/lib/trust";
import { getFindingCountForRun } from "@/lib/securityFindings";
import AgentFlameGraph from "@/components/AgentFlameGraph";
import AgentGuardStatus from "@/components/AgentGuardStatus";
import DebuggerShell from "@/components/debugger/DebuggerShell";
import WholeRunReplay from "./WholeRunReplay";
import EnrollButton from "./EnrollButton";
import IncidentButton from "./IncidentButton";
import { TrustChainPanel } from "./TrustChain";
import type { LlmEvent, ToolEvent } from "@runback/schema";

export const dynamic = "force-dynamic";

const short = (h?: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");

export default async function AppRunDetail({ params }: { params: Promise<{ run_id: string }> }) {
  const { run_id } = await params;
  const session = await requireSession();

  // Tenant isolation: the run must belong to the signed-in org.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: scope } = await sb.from("ad_runs").select("org_id").eq("run_id", run_id).maybeSingle();
  if (!scope || scope.org_id !== session.orgId) notFound();

  const data = await getRun(run_id, session.orgId);
  if (!data) notFound();
  const cassette = cassetteDigestFromEvents(data.events);
  const firstLlm = data.events.find((e): e is LlmEvent => e.type === "llm");

  // Corpus enroll: detect policy blocks + errors for the EnrollButton.
  const firstPolicyBlock = data.events.find(
    (e): e is ToolEvent => e.type === "tool" && !!(e as ToolEvent).policy_block
  );
  const policyBlocks = data.events.filter(
    (e): e is ToolEvent => e.type === "tool" && !!(e as ToolEvent).policy_block
  ).length;
  const showEnroll = data.run.status === "error" || policyBlocks > 0;
  const enrollReason: "policy_block" | "error" = policyBlocks > 0 ? "policy_block" : "error";
  const enrollDetail =
    policyBlocks > 0 && firstPolicyBlock?.policy_block
      ? `${firstPolicyBlock.tool_name} blocked — ${firstPolicyBlock.policy_block.rule}`
      : (data.run.error as { message?: string } | null)?.message ?? "error";
  const capturedModel = firstLlm?.model.model_id ?? "gpt-4o";

  // The signed, re-executable audit record — the tangible artifact.
  let audit = null;
  try { audit = await buildAuditRecord(run_id, new Date().toISOString(), session.orgId); } catch { /* ignore */ }
  const m = audit?.manifest;

  // Determinism — an Enterprise capability (self-host unlocks it via RUNBACK_LICENSE).
  // Also surfaced in the hosted demo so the capability is visible there.
  const { data: orgRow } = await sb.from("orgs").select("plan,trial_ends_at").eq("id", session.orgId).maybeSingle();
  // Trial-aware: featurePlan(), not the raw org.plan column — a trial org's
  // plan is literally "free" (trial status lives in trial_ends_at), so every
  // gate below was invisible to every trial user until this used the same
  // trial-aware resolution the rest of the app relies on (see planGate.ts).
  const orgPlan = featurePlan({ plan: orgRow?.plan, trial_ends_at: orgRow?.trial_ends_at });
  // DEMO_MODE alone missed a per-email demo login (isDemoEmail true,
  // DEMO_MODE env flag off — the normal case in production): the
  // determinism panel and the enroll button both silently failed to appear
  // for the hosted demo account, contradicting the comment directly above
  // this that says the capability is "also surfaced in the hosted demo".
  const demo = DEMO_MODE || isDemoEmail(session.email);
  const showDeterminism = demo || can(orgPlan, "deep_replay");
  const showIncident = showEnroll && can(orgPlan, "incidents");
  // /api/golden/enroll requires "quality" (Growth+) unless demo — without
  // this check, every free/starter org saw a working-looking "Enroll in
  // corpus" button on every failing run that always 403'd, unlike showIncident
  // right above it, which already gates correctly.
  const enrollAllowed = demo || can(orgPlan, "quality");
  const showEnrollButton = showEnroll && enrollAllowed;
  const det = showDeterminism ? determinismReport(data.events) : null;

  // Sealed external guardrail findings (Initiative 4) — one compact count, not
  // a new section: reuses the same enterprise gate as the key that issues
  // findings credentials in Settings (see /api/runs/[run_id]/security-findings).
  const showFindings = demo || can(orgPlan, "compliance");
  const findingCount = showFindings ? await getFindingCountForRun(session.orgId, run_id).catch(() => 0) : 0;

  return (
    <div className="apprun">
      <div className="run-header-bar">
        <Link href="/app/runs" className="apprun-back run-back-reset mono">← Runs</Link>
        {can(orgPlan, "guard") && <AgentGuardStatus agentName={data.run.name ?? "agent"} />}
        {showEnrollButton && (
          <EnrollButton runId={run_id} reason={enrollReason} detail={enrollDetail} />
        )}
        {showIncident && (
          <IncidentButton
            runId={run_id}
            runName={data.run.name}
            rootCause={enrollDetail}
            severity={policyBlocks > 0 ? "high" : "medium"}
          />
        )}
        {findingCount > 0 && (
          <span
            className="pill pill-error mono"
            title="Sealed findings from an external security/guardrail integration — see Settings → Security Findings Key"
          >
            🔒 {findingCount} security finding{findingCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Primary: multi-agent graph when relevant */}
      {can(orgPlan, "multiagent") && (
        <AgentGraphSection runId={run_id} orgId={session.orgId} />
      )}

      {can(orgPlan, "multiagent") && (
        <TrustChainSection runId={run_id} runName={data.run.name ?? "agent"} orgId={session.orgId} />
      )}

      {/* Determinism — useful context before the debugger */}
      {det && (
        <section className="det-card">
          <div className="det-head">
            <span className="det-title">Determinism</span>
            <span className="det-badge mono" data-level={det.level}>
              {det.level === "full" ? "Full · byte-exact" : det.level === "oracle-only" ? "Partial · LLM + tool" : "Not captured"} · {det.score}
            </span>
          </div>
          <p className="det-sub">{det.note}</p>
          {(det.oracleSteps > 0 || det.envReads > 0) && (
            <div className="det-counts">
              {([
                ["llm", det.counts.llm],
                ["tool", det.counts.tool],
                ["clock", det.counts.now + det.counts.date],
                ["random", det.counts.random],
                ["uuid", det.counts.uuid],
                ["fetch", det.counts.fetch],
              ] as const)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => (
                  <span key={k} className="det-chip mono">{n} {k}</span>
                ))}
            </div>
          )}
        </section>
      )}

      {/* Main event: the full debugger shell */}
      {/* Env reads are substrate detail — keep out of the visual timeline to reduce clutter. */}
      <DebuggerShell run={data.run} events={data.events.filter((e) => e.type !== "env")} cassetteDigest={cassette.digest} embedded />

      <WholeRunReplay runId={run_id} capturedModel={capturedModel} />

      {/* Audit & compliance records — secondary, collapsed by default */}
      {(m || demo || can(orgPlan, "proof")) && (
        <div className="run-audit-section">
          <details className="run-audit-details">
            <summary className="run-audit-summary">
              <span className="run-audit-chevron mono">›</span>
              {m?.signed ? "Signed audit record" : "Audit record"}
              {m && <span className="run-event-count">· {m.event_count} events</span>}
            </summary>
            {m && (
              <section className="audit-card">
                <div className="audit-card-main">
                  <div className="audit-card-head">
                    <span className="audit-card-title">Signed audit record</span>
                    {m.signed
                      ? <span className="audit-badge ok mono">✓ signed · {m.signature?.alg ?? "HMAC-SHA256"}</span>
                      : <span className="audit-badge mono">unsigned</span>}
                  </div>
                  <p className="audit-card-sub">
                    Tamper-evident and <strong>re-executable</strong> — {m.event_count} hash-chained events plus the
                    oracle stream. Recompute the chain, replay the cassette, verify the signature.
                  </p>
                  <div className="audit-digests">
                    <div><span className="audit-dk mono">content</span><span className="audit-dv mono">{short(m.content_digest)}</span></div>
                    <div><span className="audit-dk mono">replay</span><span className="audit-dv mono">{short(m.replay?.cassette_digest)}</span></div>
                    <div><span className="audit-dk mono">events</span><span className="audit-dv mono">{m.event_count}</span></div>
                  </div>
                </div>
                <div className="audit-card-actions">
                  <a className="btn-fill" href={`/api/runs/${run_id}/audit`} download={`runback-audit-${run_id}.json`}>⤓ Download signed audit</a>
                  <Link className="audit-verify mono" href="/how-it-works#audit" scroll={false}>How to verify →</Link>
                </div>
              </section>
            )}
            {(demo || can(orgPlan, "proof")) && (
              <section className={`audit-card${m ? " run-proof-mt" : ""}`}>
                <div className="audit-card-main">
                  <div className="audit-card-head">
                    <span className="audit-card-title">Policy proof bundle</span>
                    <span className="audit-badge mono">Enterprise · cryptographic</span>
                  </div>
                  <p className="audit-card-sub">
                    Verifiable bundle proving which policies evaluated this run, what was blocked, and that the
                    record is sealed in the tamper-evident ledger — with a Merkle inclusion proof.
                  </p>
                </div>
                <div className="audit-card-actions">
                  <a className="btn-fill" href={`/api/proof/${run_id}`} download={`runback-proof-${run_id.slice(0, 10)}.json`}>
                    ⤓ Download proof bundle
                  </a>
                  <Link className="audit-verify mono" href="/app/compliance">Compliance artifacts →</Link>
                </div>
              </section>
            )}
          </details>
        </div>
      )}
    </div>
  );
}

// ── Multi-agent graph — server component rendered inline ──────────────────────

const fmtMs = (ms: number | null) => {
  if (!ms) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
};

function AgentNodeRow({ node, orgId }: { node: AgentNode; orgId: string }) {
  const indent = node.depth * 20;
  const durationMs = node.started_at && node.ended_at
    ? new Date(node.ended_at).getTime() - new Date(node.started_at).getTime()
    : null;
  return (
    <>
      <tr>
        <td style={{ paddingLeft: `${12 + indent}px` }}>
          <Link href={`/app/runs/${node.run_id}`} className="mono appc-link">
            {node.depth > 0 ? "↳ " : ""}{node.name}
          </Link>
        </td>
        <td>
          <span className={`pill pill-${node.status === "error" ? "error" : node.status === "success" ? "ok" : "muted"}`}>
            {node.status}
          </span>
        </td>
        <td className="mono">{node.step_count ?? "—"}</td>
        <td className="mono">{node.total_tokens?.toLocaleString() ?? "—"}</td>
        <td className="mono">{fmtMs(durationMs)}</td>
      </tr>
      {node.children.map((c) => (
        <AgentNodeRow key={c.run_id} node={c} orgId={orgId} />
      ))}
    </>
  );
}

async function AgentGraphSection({ runId, orgId }: { runId: string; orgId: string }) {
  const graph = await getAgentGraph(runId, orgId).catch(() => null);
  if (!graph || (graph.totalRuns <= 1 && !graph.root.parent_run_id)) return null;

  return (
    <section className="audit-card run-graph-section">
      <div className="audit-card-main run-graph-main">
        <div className="audit-card-head">
          <span className="audit-card-title">Agent execution graph</span>
          <span className="audit-badge mono">
            {graph.totalRuns} agents · {graph.totalTokens.toLocaleString()} tokens · depth {graph.maxDepth}
          </span>
        </div>
        <p className="audit-card-sub">
          Flame graph of wall-clock time per agent. Bar width = duration. Click any bar to open that agent&apos;s run.
          {" "}<Link href="/app/runs/topology" className="appc-link mono run-topology-link">Fleet topology →</Link>
        </p>

        {/* Flame graph — client component (needs hover state) */}
        <div className="run-flame-wrap">
          <AgentFlameGraph graph={graph} />
        </div>

        {/* Fallback summary table always shown below flame graph */}
        <details className="run-tree-details">
          <summary className="mono appc-dim run-tree-summary">
            Show tree table
          </summary>
          <div className="table-wrap run-table-mt">
            <table className="appc-table">
              <thead>
                <tr><th>Agent</th><th>Status</th><th>Steps</th><th>Tokens</th><th>Duration</th></tr>
              </thead>
              <tbody>
                <AgentNodeRow node={graph.root} orgId={orgId} />
              </tbody>
            </table>
          </div>
        </details>

        {graph.root.parent_run_id && (
          <p className="run-parent-note">
            <span className="mono">↑</span>{" "}
            <Link href={`/app/runs/${graph.root.parent_run_id}`} className="appc-link mono">
              View orchestrating parent →
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

// ── Trust chain — server component ────────────────────────────────────────────

async function TrustChainSection({ runId, runName, orgId }: { runId: string; runName: string; orgId: string }) {
  const graph = await getAgentGraph(runId, orgId).catch(() => null);
  // Only show when there are delegation edges (multi-agent run)
  if (!graph || graph.totalRuns <= 1) return null;

  // Attestation is persisted at ingest time (lib/ingest.ts → attestDelegation)
  // with the caller's real declared scope, if any. Nothing persists here on
  // read anymore — that used to be a lazy write-on-view that always wrote
  // scope ["*"], which on an upsert would silently overwrite a real attested
  // scope back to wildcard the next time anyone opened this page.
  const chain = await getTrustChain(runId, orgId, graph).catch(() => null);
  if (!chain) return null;

  return <TrustChainPanel chain={chain} rootName={runName} runId={runId} />;
}
