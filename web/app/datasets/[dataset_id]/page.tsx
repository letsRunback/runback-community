import Link from "next/link";
import { showcaseOrgId } from "@/lib/demoMode";
import { notFound } from "next/navigation";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import RunEvalButton from "@/components/eval/RunEvalButton";
import PassRate from "@/components/eval/PassRate";
import { getDataset } from "@/lib/eval/datasets";
import { listEvalsForDataset, type EvalRow } from "@/lib/eval/evals";
import { describeScorer } from "@/lib/eval/describe";
import { getSession } from "@/lib/auth";

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

export default async function DatasetDetailPage({
  params,
}: {
  params: Promise<{ dataset_id: string }>;
}) {
  const { dataset_id } = await params;

  let data: Awaited<ReturnType<typeof getDataset>> = null;
  let evals: EvalRow[] = [];
  let dbError = false;
  try {
    // Tenant isolation: an org-owned dataset is only visible to that org.
    const session = await getSession().catch(() => null);
    // Public page: scope to the caller's org, or the demo workspace for anon —
    // never null, which would return an unowned row to anyone.
    const scope = session?.orgId ?? (await showcaseOrgId());
    data = scope ? await getDataset(dataset_id, scope) : null;
    if (data) evals = await listEvalsForDataset(dataset_id);
  } catch {
    dbError = true;
  }

  if (dbError) {
    return (
      <>
        <Header />
        <main style={{ maxWidth: 900, margin: "0 auto", padding: "3rem 1.75rem" }}>
          <Link href="/datasets" className="mono" style={{ fontSize: "0.8rem" }}>
            ← Datasets
          </Link>
          <p className="empty" style={{ marginTop: "1rem" }}>
            Could not reach the database. Check Supabase env vars.
          </p>
        </main>
        <Footer />
      </>
    );
  }

  if (!data) notFound();
  const { dataset, items } = data;

  return (
    <>
      <Header />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2.5rem 1.75rem", minHeight: "60vh" }}>
        <Link href="/datasets" className="mono" style={{ fontSize: "0.8rem" }}>
          ← Datasets
        </Link>

        <h1 style={{ fontSize: "1.8rem", letterSpacing: "-0.035em", margin: "1rem 0 0.3rem" }}>
          {dataset.name}
        </h1>
        {dataset.description && <p className="mk-lead" style={{ fontSize: "0.95rem" }}>{dataset.description}</p>}
        <p className="mono" style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginTop: "0.3rem" }}>
          {items.length} {items.length === 1 ? "item" : "items"} · {dataset.id}
        </p>

        {/* Run an eval */}
        <div className="card" style={{ padding: "1.2rem 1.3rem", margin: "1.6rem 0" }}>
          <div className="insp-h" style={{ marginTop: 0 }}>Run an eval</div>
          <p className="empty" style={{ fontSize: "0.85rem", marginBottom: "0.9rem" }}>
            Replays every item and scores the output. Use the captured model for a
            regression check, or override the model to compare.
          </p>
          <RunEvalButton datasetId={dataset.id} disabled={items.length === 0} />
        </div>

        {/* Items */}
        <div className="insp-h">Items</div>
        {items.length === 0 ? (
          <p className="empty">
            No items yet. Add captured LLM steps from a run&apos;s{" "}
            <span style={{ color: "var(--text-secondary)" }}>Replay</span> tab.
          </p>
        ) : (
          <ul style={{ listStyle: "none", display: "grid", gap: "0.55rem" }}>
            {items.map((it) => (
              <li key={it.id} className="card" style={{ padding: "0.85rem 1.1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {it.label ?? "(unlabelled)"}
                  </span>
                  <span className="mono" style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                    {it.model.model_id}
                  </span>
                  {it.source_run_id && (
                    <Link
                      href={`/runs/${it.source_run_id}`}
                      className="mono"
                      style={{ marginLeft: "auto", color: "var(--brand)", fontSize: "0.72rem" }}
                    >
                      source run →
                    </Link>
                  )}
                </div>
                <div className="scorer-chips">
                  {it.scorers.map((s, i) => (
                    <span key={i} className="scorer-chip">
                      {describeScorer(s)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Past evals */}
        {evals.length > 0 && (
          <>
            <div className="insp-h">Eval history</div>
            <ul style={{ listStyle: "none", display: "grid", gap: "0.5rem" }}>
              {evals.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/evals/${e.id}`}
                    className="card"
                    style={{ display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.8rem 1.1rem" }}
                  >
                    <span className={`pill pill-${e.status === "done" ? "success" : e.status === "error" ? "error" : "running"}`}>
                      {e.status}
                    </span>
                    <span className="mono" style={{ color: "var(--text-muted)", fontSize: "0.74rem" }}>
                      {e.model_id ?? "captured model"}
                    </span>
                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.85rem" }}>
                      <PassRate pass={e.passed} total={e.total} />
                      <span className="mono" style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                        {timeAgo(e.created_at)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
