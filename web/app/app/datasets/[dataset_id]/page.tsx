import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { getDataset } from "@/lib/eval/datasets";
import { listEvalsForDataset, type EvalRow } from "@/lib/eval/evals";
import RunEvalButton from "@/components/eval/RunEvalButton";
import PassRate from "@/components/eval/PassRate";
import AdversarialPanel from "@/components/eval/AdversarialPanel";

export const dynamic = "force-dynamic";

async function inOrg(table: string, id: string, orgId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data } = await sb.from(table).select("org_id").eq("id", id).maybeSingle();
  return !!data && data.org_id === orgId;
}

export default async function AppDatasetDetail({ params }: { params: Promise<{ dataset_id: string }> }) {
  const { dataset_id } = await params;
  const session = await requireSession();
  if (!(await inOrg("ad_datasets", dataset_id, session.orgId))) notFound();

  const data = await getDataset(dataset_id, session.orgId);
  if (!data) notFound();
  const { dataset, items } = data;
  let evals: EvalRow[] = [];
  try { evals = await listEvalsForDataset(dataset_id); } catch { /* db */ }

  return (
    <div className="apprun">
      <Link href="/app/datasets" className="apprun-back mono">← Datasets</Link>
      <div className="appc-head appc-head-row">
        <div>
          <h1 className="appc-h1">{dataset.name}</h1>
          <p className="appc-sub">{items.length} {items.length === 1 ? "item" : "items"}{dataset.description ? ` · ${dataset.description}` : ""}</p>
        </div>
        {items.length > 0 && <RunEvalButton datasetId={dataset_id} basePath="/app/evals" />}
      </div>

      {evals.length > 0 && (
        <section className="ds-eval-section">
          <div className="dash-panel-h">Eval history</div>
          <div className="table-wrap">
            <table className="appc-table">
              <thead><tr><th>Status</th><th>Eval</th><th>Model</th><th>Pass</th></tr></thead>
              <tbody>
                {evals.map((e) => (
                  <tr key={e.id}>
                    <td><span className={`pill pill-${e.status === "done" ? "ok" : e.status === "error" ? "error" : "muted"}`}>{e.status}</span></td>
                    <td><Link href={`/app/evals/${e.id}`} className="appc-link">{e.name ?? "Eval"}</Link></td>
                    <td className="mono appc-dim">{e.model_id ?? "captured"}</td>
                    <td>{e.status === "done" ? <PassRate pass={e.passed} total={e.total} /> : <span className="appc-dim">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="dash-panel-h">Items</div>
      {items.length === 0 ? (
        <p className="empty ds-empty-hint">No items yet. Capture a step from a run&apos;s replay panel with <span className="mono">Add to dataset</span>.</p>
      ) : (
        <ul className="ds-items">
          {items.filter((it) => it.source !== "synthetic").map((it) => (
            <li key={it.id} className="ds-item">
              <span className="ds-item-label">{it.label ?? "(unlabelled)"}</span>
              <span className="mono appc-dim">{it.model?.model_id ?? "—"}</span>
              <span className="mono appc-dim">{it.scorers?.length ?? 0} {it.scorers?.length === 1 ? "check" : "checks"}</span>
            </li>
          ))}
        </ul>
      )}

      <AdversarialPanel
        datasetId={dataset_id}
        syntheticItems={items
          .filter((it) => it.source === "synthetic")
          .map((it) => ({ id: it.id, label: it.label, approval_status: it.approval_status, generated_rationale: it.generated_rationale }))}
      />
    </div>
  );
}
