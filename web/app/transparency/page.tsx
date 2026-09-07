import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import TransparencyLookup from "@/components/site/TransparencyLookup";
import { pageMetadata } from "@/lib/seo";
import { readLog, verifyLogChain } from "@/lib/transparency";

export const metadata = pageMetadata({
  path: "/transparency",
  title: "Transparency log — check any workspace's public ledger status",
  description:
    "The public, append-only feed of every sealed ledger checkpoint across every Runback workspace. Paste a log id to see one workspace's history, or read the raw feed yourself.",
});

export const dynamic = "force-dynamic";

export default async function TransparencyPage() {
  const entries = await readLog(0, 500).catch(() => []);
  const chain = verifyLogChain(entries);
  const latest = entries[entries.length - 1];

  return (
    <>
      <Header />
      <main className="mk">
        <span className="mk-eyebrow">Transparency</span>
        <h1 className="mk-h2" style={{ marginTop: "1rem" }}>One feed, every workspace, nobody can quietly edit.</h1>
        <p className="mk-lead" style={{ maxWidth: "62ch" }}>
          Every workspace that seals an audit-ledger checkpoint publishes it here, hash-chained to the
          entry before it. It reveals nothing about any workspace beyond &quot;this one sealed a
          checkpoint&quot; — no run content, no customer name — but it stops us keeping two divergent
          histories, since a second, different head for the same checkpoint cannot even be written
          quietly.
        </p>

        <section className="mk-section">
          <div className="transparency-global-stats">
            <div className="transparency-stat">
              <span className="transparency-stat-value mono">{entries.length.toLocaleString()}</span>
              <span className="transparency-stat-label">entries in the latest page of the feed</span>
            </div>
            <div className="transparency-stat">
              <span className={`transparency-stat-value mono ${chain.ok ? "cmp-y" : "cmp-n"}`}>
                {chain.ok ? "intact" : `broken at seq ${chain.brokenAt}`}
              </span>
              <span className="transparency-stat-label">chain status (this page)</span>
            </div>
            {latest && (
              <div className="transparency-stat">
                <span className="transparency-stat-value mono">{new Date(latest.published_at).toLocaleString()}</span>
                <span className="transparency-stat-label">most recent publish</span>
              </div>
            )}
          </div>
        </section>

        <section className="mk-section">
          <span className="mk-eyebrow">Check one workspace</span>
          <h2 className="mk-h2">Paste a log id.</h2>
          <p className="mk-lead" style={{ maxWidth: "62ch", fontSize: "0.92rem" }}>
            Every workspace with a sealed ledger has one, visible on its own{" "}
            <Link href="/app/ledger" className="mk-link">Audit ledger</Link> page and embedded in its
            public status badge (<code className="mono">rbl_</code> followed by 24 hex characters).
          </p>
          <TransparencyLookup />
        </section>

        <section className="mk-section">
          <span className="mk-eyebrow">Verify it yourself</span>
          <h2 className="mk-h2">No account, no Runback software.</h2>
          <div className="docs-code-block">
            <div className="docs-code-lang mono">bash</div>
            <pre className="docs-code"><code>{`# The full feed, or one workspace's slice of it
curl https://runback.dev/api/transparency
curl https://runback.dev/api/transparency?log=rbl_xxxxxxxxxxxxxxxxxxxxxxxx

# Each entry: entry_hash = sha256(prev_hash + RFC8785({ckpt_seq, head_hash, log_id, merkle_root}))
# Archive a response today; re-fetch tomorrow; the archived entries must reappear
# byte-for-byte with the same entry_hash, or the feed was rewritten.`}</code></pre>
          </div>
        </section>

        <section className="mk-section">
          <span className="mk-eyebrow">Honest limits</span>
          <h2 className="mk-h2">What this page does not claim.</h2>
          <ul className="docs-list" style={{ maxWidth: "62ch" }}>
            <li>
              A per-workspace lookup shows that workspace&apos;s entries but cannot verify the full
              chain on its own — other workspaces&apos; interleaved entries are what the linkage
              depends on. Fetch the unfiltered feed to actually verify the chain.
            </li>
            <li>
              This proves the feed hasn&apos;t been silently rewritten. It does not prove what happened
              inside any run — that&apos;s what a workspace&apos;s own audit export and{" "}
              <Link href="/verify" className="mk-link">@runback/verify</Link> are for.
            </li>
          </ul>
        </section>
      </main>
      <Footer />
    </>
  );
}
