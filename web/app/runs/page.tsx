import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { listRuns } from "@/lib/runs";
import { showcaseOrgId } from "@/lib/demoMode";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/runs",
  title: "Live agent runs",
  description:
    "Recent instrumented agent runs, captured with full context so any decision can be re-executed and verified.",
});

// Not force-dynamic: this is the same public showcase org for every visitor,
// not session-specific, so there is nothing to gain from an uncached hit on
// every single request. force-dynamic combined with no timeout on the
// Supabase call meant a single transient DB blip served a one-line "Couldn't
// reach the database" page to whoever hit it at that moment — including
// Googlebot, which is exactly the thin, error-flavored content its soft-404
// heuristic is built to catch. Revalidating on a short window means a bad
// request during regeneration keeps serving the last good render (stale-
// while-revalidate) instead of the error page going live.
export const revalidate = 60;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function RunsPage() {
  let runs: Awaited<ReturnType<typeof listRuns>> = [];
  let dbError = false;
  // Scoped to the demo workspace. The old form queried every org's runs and
  // relied on DEMO_MODE being off in production to stay safe — but the hosted
  // site runs with it ON, so this page was serving real run data unauthenticated.
  const showcaseOrg = await showcaseOrgId();
  if (showcaseOrg) {
    try {
      runs = await listRuns(100, showcaseOrg);
    } catch {
      dbError = true;
    }
  }

  return (
    <>
      <Header />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2.75rem 1.75rem", minHeight: "60vh" }}>
        <span className="mk-eyebrow">
          Live
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.85rem", margin: "0.9rem 0 0.4rem" }}>
          <h1 style={{ fontSize: "1.9rem", letterSpacing: "-0.035em" }}>Runs</h1>
          <span className="mono" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            {runs.length}
          </span>
        </div>
        <p className="mk-lead" style={{ marginBottom: "1rem", fontSize: "0.98rem" }}>
          Each row below is a real captured agent run, not a mockup — every
          model call, tool call, and reasoning step, held exactly as the agent
          produced it. Open one to see the full context window at the step
          that mattered, replay it from that exact point, and check the
          signed, hash-chained record against{" "}
          <Link href="/spec" style={{ color: "var(--brand)" }}>
            the runback.cassette/v1 spec
          </Link>
          {" "}yourself — no account required.
        </p>
        <p className="mk-lead" style={{ marginBottom: "2rem", fontSize: "0.98rem" }}>
          The <span className="mono">error</span> rows aren&apos;t failures we
          hid — some are a policy gate blocking a step before it reached a
          customer, the same mechanism{" "}
          <Link href="/how-it-works" style={{ color: "var(--brand)" }}>
            walked in the incident guide
          </Link>
          ; others are a genuine downstream failure, like a declined card. New
          to this?{" "}
          <Link href="/how-it-works" style={{ color: "var(--brand)" }}>
            Start with the guide →
          </Link>
        </p>

        {dbError ? (
          <p className="empty">Couldn&apos;t reach the database. Check the Supabase configuration.</p>
        ) : runs.length === 0 ? (
          <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
            <p style={{ color: "var(--text-primary)", fontWeight: 500, marginBottom: "0.4rem" }}>
              No runs yet.
            </p>
            <p className="empty">
              Run an instrumented agent — or the bundled demo — and its runs
              appear here. See{" "}
              <Link href="/how-it-works" style={{ color: "var(--brand)" }}>
                how to connect an agent
              </Link>
              .
            </p>
          </div>
        ) : (
          <div>
          <p className="table-scroll-hint mono">Swipe to see all columns →</p>
          <div className="table-scroll">
          <table className="runtable">
            <thead>
              <tr>
                <th>Status</th>
                <th>Run</th>
                <th>Steps</th>
                <th>Tokens</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.run_id}>
                  <td>
                    <span className={`pill pill-${r.status}`}>{r.status}</span>
                  </td>
                  <td>
                    <Link href={`/runs/${r.run_id}`}>{r.name}</Link>
                    <div className="mono" style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                      {r.run_id}
                    </div>
                  </td>
                  <td className="mono">{r.step_count}</td>
                  <td className="mono">{r.total_tokens.toLocaleString()}</td>
                  <td className="mono" style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
                    {timeAgo(r.started_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
