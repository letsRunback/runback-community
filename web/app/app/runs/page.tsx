import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listRuns } from "@/lib/runs";
import FleetDeterminism from "./FleetDeterminism";
import SampleDataEmpty from "../SampleDataEmpty";
import { Donut } from "@/components/app/charts";

export const dynamic = "force-dynamic";

const tok = (n: number | null) => n == null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);

export default async function AppRuns({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const welcome = sp.welcome === "1";
  let runs: Awaited<ReturnType<typeof listRuns>> = [];
  let dbError = false;
  try {
    runs = await listRuns(100, session.orgId);
  } catch {
    dbError = true;
  }

  const firstError = runs.find((r) => r.status === "error");
  const errorCount = runs.filter((r) => r.status === "error").length;

  return (
    <div className="appc">
      <div className="appc-head">
        <h1 className="appc-h1">Runs</h1>
        <p className="appc-sub">The exact context your model saw at every step — not a log line guessing at it.</p>
        <div className="runs-head-actions">
          <Link href="/app/runs/topology" className="appc-link mono runs-nav-link">Topology →</Link>
        </div>
      </div>

      {welcome && firstError && (
        <div className="runs-welcome-banner">
          <span className="runs-welcome-icon">✓</span>
          <div className="runs-welcome-body">
            <strong>Workspace populated.</strong>{" "}
            Start with the <span className="mono">support-refund-agent</span> run below — it&apos;s a caught policy breach you can replay step by step.
          </div>
          <Link href={`/app/runs/${firstError.run_id}`} className="btn-fill btn-sm">
            Open it →
          </Link>
        </div>
      )}

      {!welcome && firstError && (
        <div className="runs-welcome-banner">
          <span className="runs-welcome-icon" data-warn>!</span>
          <div className="runs-welcome-body">
            <strong>{errorCount} failed run{errorCount === 1 ? "" : "s"}</strong>{" "}
            in this list — open one to see the exact step it broke on and replay it to reproduce.
          </div>
          <Link href={`/app/runs/${firstError.run_id}`} className="btn-fill btn-sm">
            Open it →
          </Link>
        </div>
      )}

      {!dbError && runs.length > 0 && <FleetDeterminism />}

      {dbError ? (
        <p className="empty">Could not reach the database.</p>
      ) : runs.length === 0 ? (
        <>
          <SampleDataEmpty
            badge="Runs · observe"
            title="Every decision your agents make — captured."
            lead="A run is one agent execution, recorded step by step: the exact context the model saw, the tools it called, and where it broke. Open one to time-travel through it or replay it on another model."
            points={[
              "See exactly what the model saw at every step — not a wall of logs",
              "Re-run any decision, on any model, from a real failure",
              "Connect your own agent with the SDK or OpenTelemetry",
            ]}
          />
          <div className="onb-snippet-wrap" style={{ marginTop: "2rem", maxWidth: "640px" }}>
            <div className="onb-snippet-label mono" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>Connect your agent in 3 lines — get your key in <Link href="/app/settings" className="appc-link">Settings → API Key (SDK)</Link></div>
            <pre className="onb-snippet"><code>{`import { withDebugger } from "@runback/sdk";

const agent = withDebugger(model, {
  apiKey: process.env.RUNBACK_API_KEY,
});`}</code></pre>
          </div>
        </>
      ) : (
        <>
          {(() => {
            const success = runs.filter((r) => r.status === "success").length;
            const running = runs.filter((r) => r.status === "running").length;
            const other = runs.length - success - errorCount - running;
            return (
              <div className="runs-status-glance">
                <Donut
                  segments={[
                    { value: success, color: "var(--emerald)", label: "success" },
                    { value: errorCount, color: "var(--rose)", label: "error" },
                    { value: running, color: "var(--blue)", label: "running" },
                    { value: other, color: "var(--border-strong)", label: "other" },
                  ].filter((s) => s.value > 0)}
                  size={96}
                />
                <div className="runs-status-legend mono">
                  <span><span className="runs-status-dot" style={{ background: "var(--emerald)" }} />{success} success</span>
                  <span><span className="runs-status-dot" style={{ background: "var(--rose)" }} />{errorCount} error</span>
                  {running > 0 && <span><span className="runs-status-dot" style={{ background: "var(--blue)" }} />{running} running</span>}
                </div>
              </div>
            );
          })()}
          <div className="table-wrap">
          <table className="appc-table">
            <thead>
              <tr><th>Run</th><th>Status</th><th>Steps</th><th>Tokens</th><th>Started</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.run_id}>
                  <td><Link href={`/app/runs/${r.run_id}`} className="mono appc-link">{r.name || r.run_id}</Link></td>
                  <td><span className={`pill pill-${r.status === "error" ? "error" : r.status === "success" ? "ok" : "muted"}`}>{r.status}</span></td>
                  <td className="mono">{r.step_count ?? "—"}</td>
                  <td className="mono">{tok(r.total_tokens ?? null)}</td>
                  <td className="mono appc-dim">{r.started_at ? new Date(r.started_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
