import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listEvals, type EvalRow } from "@/lib/eval/evals";
import PassRate from "@/components/eval/PassRate";
import SampleDataEmpty from "../SampleDataEmpty";

export const dynamic = "force-dynamic";

const ago = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

export default async function AppEvals() {
  const session = await requireSession();
  let evals: EvalRow[] = [];
  try { evals = await listEvals(session.orgId); } catch { /* db */ }

  return (
    <div className="appc">
      <div className="appc-head">
        <h1 className="appc-h1">Evals</h1>
        <p className="appc-sub">Your release gate — green ships, a red row blocks.</p>
      </div>

      {evals.length === 0 ? (
        <SampleDataEmpty
          badge="Evals · the release gate"
          title="Catch a regression before it ships."
          lead="An eval re-runs a frozen set of real agent steps and scores each against your checks. Green means your change is safe; a red row is a regression you caught before a customer did."
          points={[
            "Turn any real run into a test case in one click",
            "Run the suite as a release gate — a regression fails the build",
            "Diff a candidate against a baseline to see exactly what changed",
          ]}
        />
      ) : (
        <div className="table-wrap">
          <table className="appc-table">
            <thead><tr><th>Status</th><th>Eval</th><th>Dataset</th><th>Model</th><th>Pass</th><th>Started</th></tr></thead>
            <tbody>
              {evals.map((e) => (
                <tr key={e.id}>
                  <td><span className={`pill pill-${e.status === "done" ? "ok" : e.status === "error" ? "error" : "muted"}`}>{e.status}</span></td>
                  <td><Link href={`/app/evals/${e.id}`} className="appc-link">{e.name ?? "Eval"}</Link></td>
                  <td><Link href={`/app/datasets/${e.dataset_id}`} className="mono appc-dim">{e.dataset_name ?? "—"}</Link></td>
                  <td className="mono appc-dim">{e.model_id ?? "captured"}</td>
                  <td>{e.status === "done" ? <PassRate pass={e.passed} total={e.total} /> : <span className="appc-dim">—</span>}</td>
                  <td className="mono appc-dim">{ago(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
