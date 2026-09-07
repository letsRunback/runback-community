import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listDatasets, type DatasetRow } from "@/lib/eval/datasets";
import NewDatasetButton from "@/components/eval/NewDatasetButton";

export const dynamic = "force-dynamic";

export default async function AppDatasets() {
  const session = await requireSession();
  let datasets: DatasetRow[] = [];
  try { datasets = await listDatasets(session.orgId); } catch { /* db */ }

  return (
    <div className="appc">
      <div className="appc-head appc-head-row">
        <div>
          <h1 className="appc-h1">Datasets</h1>
          <p className="appc-sub">Frozen test cases — the input to your gate.</p>
        </div>
        <NewDatasetButton basePath="/app/datasets" />
      </div>

      {datasets.length === 0 ? (
        <div className="appc-empty">
          <p>No datasets yet.</p>
          <p className="empty">
            Open a run, expand a step’s replay panel, and click <span className="mono">Add to dataset</span> — or create an empty one above.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="appc-table">
            <thead><tr><th>Dataset</th><th>Items</th><th>Description</th><th>Created</th></tr></thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.id}>
                  <td><Link href={`/app/datasets/${d.id}`} className="appc-link">{d.name}</Link></td>
                  <td className="mono">{d.item_count}</td>
                  <td className="appc-dim">{d.description || "—"}</td>
                  <td className="mono appc-dim">{new Date(d.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
