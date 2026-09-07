import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { getEval, type EvalScoreRow } from "@/lib/eval/evals";
import { diffEvals, type RegressionReport } from "@/lib/eval/regression";
import PassRate from "@/components/eval/PassRate";
import SetBaseline from "./SetBaseline";

export const dynamic = "force-dynamic";

export default async function AppEvalDetail({ params }: { params: Promise<{ eval_id: string }> }) {
  const { eval_id } = await params;
  const session = await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: scope } = await sb.from("ad_eval_runs").select("org_id,baseline_eval_id,policy_id").eq("id", eval_id).maybeSingle();
  if (!scope || scope.org_id !== session.orgId) notFound();

  const data = await getEval(eval_id, session.orgId);
  if (!data) notFound();
  const { eval: ev, results } = data;

  // Regression-at-scale: diff against the dataset's designated baseline.
  let regression: RegressionReport | null = null;
  if (scope.baseline_eval_id && scope.baseline_eval_id !== eval_id) {
    regression = await diffEvals(scope.baseline_eval_id, eval_id).catch(() => null);
  }
  const policyName = scope.policy_id ? (await sb.from("ad_policies").select("name,version").eq("id", scope.policy_id).maybeSingle()).data : null;

  return (
    <div className="apprun">
      <Link href="/app/evals" className="apprun-back mono">← Evals</Link>
      <div className="appc-head">
        <div className="eval-title-row">
          <h1 className="appc-h1">{ev.name ?? "Eval"}</h1>
          <span className={`pill pill-${ev.status === "done" ? "ok" : ev.status === "error" ? "error" : "muted"}`}>{ev.status}</span>
        </div>
        <p className="appc-sub">
          <Link href={`/app/datasets/${ev.dataset_id}`} className="eval-dataset-link">{ev.dataset_name ?? "dataset"}</Link>
          {" · "}model: <span className="mono">{ev.model_id ?? "captured per item"}</span>
          {policyName && <> · policy: <span className="mono">{policyName.name} v{policyName.version}</span></>}
        </p>
      </div>

      <div className="eval-top">
        <div className="eval-passrate-wrap">
          {ev.status === "done" ? <PassRate pass={ev.passed} total={ev.total} /> : <span className="appc-dim">scoring…</span>}
        </div>
        {ev.status === "done" && <SetBaseline evalId={eval_id} />}
        {ev.status === "done" && (
          <Link href={`/app/evals/compare?a=${eval_id}`} className="appc-link mono">
            Compare against another eval →
          </Link>
        )}
      </div>

      {regression && (
        <div className={`regr ${regression.gatePassed ? "ok" : "bad"}`}>
          <div className="regr-head">
            <strong>{regression.gatePassed ? "✓ No regressions vs baseline" : `✗ ${regression.regressions.length} regression${regression.regressions.length === 1 ? "" : "s"} — gate blocks this`}</strong>
            <span className="mono">{regression.compared} compared · {regression.improvements.length} improved · {regression.unchanged} same{regression.onlyInCandidate ? ` · ${regression.onlyInCandidate} new` : ""}</span>
          </div>
          {regression.regressions.length > 0 && (
            <ul className="regr-list">
              {regression.regressions.map((r) => (
                <li key={r.item_id}><span className="verdict fail">REGRESSED</span> {r.label ?? r.item_id}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {results.length === 0 ? (
        // Was a bare muted line with no explanation. The other empty states in
        // this area (models/gate, models/diff, policies/library) all use
        // .appc-empty and say what to do next; this one did not.
        <div className="appc-empty">
          No results recorded for this eval. If it is still running, results appear as each
          item is scored. If it finished with none, the dataset had no items to score —
          add items to the dataset and run it again.
        </div>
      ) : (
        <ul className="eval-results">
          {results.map((r) => <ResultRow key={r.item_id} result={r} />)}
        </ul>
      )}
    </div>
  );
}

function ResultRow({ result }: { result: EvalScoreRow }) {
  const out = result.output;
  const preview = out?.text?.trim() || (out?.tool_calls?.length ? `→ ${out.tool_calls.map((t) => t.tool_name).join(", ")}` : "") || "(no content)";
  return (
    <li className="eval-row" data-passed={result.passed}>
      <div className="eval-row-top">
        <span className={`verdict ${result.passed ? "pass" : "fail"}`}>{result.passed ? "PASS" : "FAIL"}</span>
        <span className="eval-row-label">{result.label ?? "(unlabelled)"}</span>
        {out?.latency_ms != null && <span className="mono appc-dim eval-latency">{out.latency_ms} ms</span>}
      </div>
      <div className="scorer-chips">
        {result.results.map((s, i) => (
          <span key={i} className="scorer-result" data-passed={s.passed} title={s.detail ?? ""}>
            {s.passed ? "✓" : "✗"} {s.scorer}{s.detail ? <span className="sr-detail"> — {s.detail}</span> : null}
          </span>
        ))}
      </div>
      <div className="eval-row-out mono">{preview}</div>
    </li>
  );
}
