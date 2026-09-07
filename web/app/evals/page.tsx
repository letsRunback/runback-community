import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import PassRate from "@/components/eval/PassRate";
import { listEvals, type EvalRow } from "@/lib/eval/evals";
import { pageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/auth";

export const metadata = pageMetadata({
  path: "/evals",
  title: "Evals",
  description: "Dataset-driven evaluation runs for your agents.",
  // Org-scoped, so an anonymous crawler sees an empty page. Indexing a
  // shell competes with real pages for crawl budget.
  robots: { index: false, follow: true },
});

export const dynamic = "force-dynamic";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function EvalsPage() {
  let evals: EvalRow[] = [];
  let dbError = false;
  try {
    // Tenant isolation: only the signed-in org's evals — never the whole table.
    const session = await getSession().catch(() => null);
    evals = session?.orgId ? await listEvals(session.orgId) : [];
  } catch {
    dbError = true;
  }

  return (
    <>
      <Header />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2.75rem 1.75rem", minHeight: "60vh" }}>
        <span className="mk-eyebrow">
          Evals
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.85rem", margin: "0.9rem 0 0.4rem" }}>
          <h1 style={{ fontSize: "1.9rem", letterSpacing: "-0.035em" }}>Evals</h1>
          <span className="mono" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            {evals.length}
          </span>
        </div>
        <p className="mk-lead" style={{ marginBottom: "1.6rem", fontSize: "1rem" }}>
          An eval re-runs every step in a{" "}
          <Link href="/datasets" style={{ color: "var(--brand)" }}>dataset</Link>{" "}
          and scores it against your checks. Green means your change is safe; a red
          row is a regression you caught before it shipped. Start one from any
          dataset&apos;s <span className="mono">Run eval</span> button.
        </p>

        {dbError ? (
          <p className="empty">Couldn&apos;t reach the database. Check the Supabase configuration.</p>
        ) : evals.length === 0 ? (
          <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
            <p style={{ color: "var(--text-primary)", fontWeight: 500, marginBottom: "0.4rem" }}>
              No evals yet.
            </p>
            <p className="empty">
              Open a{" "}
              <Link href="/datasets" style={{ color: "var(--brand)" }}>
                dataset
              </Link>{" "}
              and click <span className="mono">Run eval</span>.
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
                <th>Eval</th>
                <th>Dataset</th>
                <th>Model</th>
                <th>Pass</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {evals.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className={`pill pill-${e.status === "done" ? "success" : e.status === "error" ? "error" : "running"}`}>
                      {e.status}
                    </span>
                  </td>
                  <td>
                    <Link href={`/evals/${e.id}`}>{e.name ?? "Eval"}</Link>
                  </td>
                  <td>
                    <Link
                      href={`/datasets/${e.dataset_id}`}
                      className="mono"
                      style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}
                    >
                      {e.dataset_name ?? e.dataset_id}
                    </Link>
                  </td>
                  <td className="mono" style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    {e.model_id ?? "captured"}
                  </td>
                  <td>
                    <PassRate pass={e.passed} total={e.total} />
                  </td>
                  <td className="mono" style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>
                    {timeAgo(e.created_at)}
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
