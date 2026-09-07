import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import NewDatasetButton from "@/components/eval/NewDatasetButton";
import { listDatasets, type DatasetRow } from "@/lib/eval/datasets";
import { pageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/auth";

export const metadata = pageMetadata({
  path: "/datasets",
  title: "Datasets",
  description: "Captured decisions curated into evaluation datasets.",
  // Org-scoped, so an anonymous crawler sees an empty page. Indexing a
  // shell competes with real pages for crawl budget.
  robots: { index: false, follow: true },
});

export const dynamic = "force-dynamic";

export default async function DatasetsPage() {
  let datasets: DatasetRow[] = [];
  let dbError = false;
  try {
    // Tenant isolation: only the signed-in org's datasets — never the whole table.
    const session = await getSession().catch(() => null);
    datasets = session?.orgId ? await listDatasets(session.orgId) : [];
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
          <h1 style={{ fontSize: "1.9rem", letterSpacing: "-0.035em" }}>Datasets</h1>
          <span className="mono" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            {datasets.length}
          </span>
        </div>
        <p className="mk-lead" style={{ marginBottom: "1.8rem", fontSize: "1rem" }}>
          A dataset is a saved set of agent steps you want to keep an eye on —
          plus the checks each one has to pass. It&apos;s how you turn a bug you
          fixed once into a test it can&apos;t fail again.
        </p>

        <ol className="howto">
          <li>
            <span className="howto-k mono">1</span>
            <div>
              <strong>Add a step.</strong> Open a run, pick an LLM step, and click
              <span className="mono"> + Add to dataset</span> on its Replay tab.
            </div>
          </li>
          <li>
            <span className="howto-k mono">2</span>
            <div>
              <strong>Set the checks.</strong> Choose what its output must always
              do — e.g. <em>must not error</em>, <em>must call refund()</em>, or a
              plain-English rubric.
            </div>
          </li>
          <li>
            <span className="howto-k mono">3</span>
            <div>
              <strong>Run an eval.</strong> Runback replays every step and scores
              it, so a regression shows up as a red row — before it ships.
            </div>
          </li>
        </ol>

        <div style={{ margin: "0 0 2rem" }}>
          <NewDatasetButton />
        </div>

        {dbError ? (
          <p className="empty">Couldn&apos;t reach the database. Check the Supabase configuration.</p>
        ) : datasets.length === 0 ? (
          <div className="card" style={{ padding: "2rem", textAlign: "center" }}>
            <p style={{ color: "var(--text-primary)", fontWeight: 500, marginBottom: "0.4rem" }}>
              No datasets yet.
            </p>
            <p className="empty">
              Open a run, select an LLM step, go to the{" "}
              <span style={{ color: "var(--text-secondary)" }}>Replay</span> tab, and
              click <span className="mono">+ Add to dataset</span> — or create an empty
              one above.
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", display: "grid", gap: "0.6rem" }}>
            {datasets.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/datasets/${d.id}`}
                  className="card"
                  style={{ display: "flex", alignItems: "center", gap: "0.85rem", padding: "1rem 1.2rem" }}
                >
                  <span style={{ color: "var(--text-primary)", fontWeight: 550 }}>{d.name}</span>
                  {d.description && (
                    <span className="empty" style={{ fontSize: "0.85rem" }}>
                      {d.description}
                    </span>
                  )}
                  <span className="mono" style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: "0.78rem" }}>
                    {d.item_count} {d.item_count === 1 ? "item" : "items"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </>
  );
}
