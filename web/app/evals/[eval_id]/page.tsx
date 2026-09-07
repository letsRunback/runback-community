import Link from "next/link";
import { showcaseOrgId } from "@/lib/demoMode";
import { notFound } from "next/navigation";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import PassRate from "@/components/eval/PassRate";
import { getEval, type EvalScoreRow } from "@/lib/eval/evals";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function EvalDetailPage({
  params,
}: {
  params: Promise<{ eval_id: string }>;
}) {
  const { eval_id } = await params;

  let data: Awaited<ReturnType<typeof getEval>> = null;
  let dbError = false;
  try {
    // Tenant isolation: an org-owned eval is only visible to that org.
    const session = await getSession().catch(() => null);
    const scope = session?.orgId ?? (await showcaseOrgId());
    data = scope ? await getEval(eval_id, scope) : null;
  } catch {
    dbError = true;
  }

  if (dbError) {
    return (
      <>
        <Header />
        <main style={{ maxWidth: 900, margin: "0 auto", padding: "3rem 1.75rem" }}>
          <Link href="/evals" className="mono" style={{ fontSize: "0.8rem" }}>
            ← Evals
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
  const { eval: ev, results } = data;

  return (
    <>
      <Header />
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "2.5rem 1.75rem", minHeight: "60vh" }}>
        <Link href="/evals" className="mono" style={{ fontSize: "0.8rem" }}>
          ← Evals
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", margin: "1rem 0 0.4rem", flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "1.7rem", letterSpacing: "-0.035em" }}>{ev.name ?? "Eval"}</h1>
          <span className={`pill pill-${ev.status === "done" ? "success" : ev.status === "error" ? "error" : "running"}`}>
            {ev.status}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1.1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
          <Link
            href={`/datasets/${ev.dataset_id}`}
            className="mono"
            style={{ color: "var(--brand)", fontSize: "0.8rem" }}
          >
            {ev.dataset_name ?? ev.dataset_id} →
          </Link>
          <span className="mono" style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
            model: {ev.model_id ?? "captured per item"}
          </span>
          <div style={{ minWidth: 160 }}>
            <PassRate pass={ev.passed} total={ev.total} />
          </div>
        </div>

        {ev.status === "error" && (
          <div className="callout-error" style={{ marginBottom: "1.5rem" }}>
            <div className="ce-title">Eval failed</div>
            <div className="ce-msg">
              The run stopped before finishing. Check the server logs, then run it again.
            </div>
          </div>
        )}

        {results.length === 0 ? (
          <p className="empty">No results recorded.</p>
        ) : (
          <ul style={{ listStyle: "none", display: "grid", gap: "0.55rem" }}>
            {results.map((r) => (
              <ResultRow key={r.item_id} result={r} />
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </>
  );
}

function ResultRow({ result }: { result: EvalScoreRow }) {
  const out = result.output;
  const preview =
    out?.text?.trim() ||
    (out?.tool_calls?.length ? `→ ${out.tool_calls.map((t) => t.tool_name).join(", ")}` : "") ||
    "(no content)";

  return (
    <li className="card" style={{ padding: "0.9rem 1.1rem" }} data-passed={result.passed}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap" }}>
        <span className={`verdict ${result.passed ? "pass" : "fail"}`}>
          {result.passed ? "PASS" : "FAIL"}
        </span>
        <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
          {result.label ?? "(unlabelled)"}
        </span>
        {out?.latency_ms != null && (
          <span className="mono" style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: "0.72rem" }}>
            {out.latency_ms} ms
          </span>
        )}
      </div>

      {/* Scorer breakdown */}
      <div className="scorer-chips">
        {result.results.map((s, i) => (
          <span
            key={i}
            className="scorer-result"
            data-passed={s.passed}
            title={s.detail ?? ""}
          >
            {s.passed ? "✓" : "✗"} {s.scorer}
            {s.detail ? <span className="sr-detail"> — {s.detail}</span> : null}
          </span>
        ))}
      </div>

      {out?.error?.message && (
        <div className="ce-msg" style={{ color: "var(--rose)", fontSize: "0.78rem", marginTop: "0.5rem" }}>
          {out.error.message}
        </div>
      )}

      <div className="result-preview">{preview}</div>
    </li>
  );
}
