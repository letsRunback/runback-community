import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { pageMetadata } from "@/lib/seo";
import { changelogEntries, verifyChangelogChain } from "@/lib/changelog";

export const metadata = pageMetadata({
  path: "/changelog",
  title: "Changelog — hash-chained, same as the audit ledger",
  description:
    "Runback's own release history, sealed into the same hash-chain construction as the customer audit ledger. Recompute the chain yourself — the method is on this page.",
});

function short(hash: string): string {
  return `${hash.slice(0, 12)}…`;
}

export default function ChangelogPage() {
  const entries = changelogEntries();
  const check = verifyChangelogChain(entries);

  return (
    <>
      <Header />
      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">Changelog</span>
          <h1 className="hero-h1" style={{ maxWidth: "20ch" }}>
            Our own release history, <span className="accent">hash-chained</span>.
          </h1>
          <p className="hero-lead" style={{ maxWidth: "62ch" }}>
            Same construction as the customer audit ledger and the public transparency log: each release
            links to the hash of the one before it, so editing an old entry breaks every entry after it.
            If a tamper-evident chain is worth selling, it&apos;s worth running on ourselves where anyone
            can already check it.
          </p>
          <div className="changelog-status">
            <span className={`changelog-status-dot ${check.ok ? "is-ok" : "is-broken"}`} />
            {check.ok ? "Chain verified — every entry links to the one before it" : `Chain broken at entry ${check.brokenAt}`}
          </div>
        </div>
      </section>

      <main>
        <section className="mk-section">
          <div className="mk">
          <div className="changelog-timeline">
            {entries.map((e) => (
              <article key={e.seq} className="changelog-entry">
                <div className="changelog-rail">
                  <span className="changelog-dot" />
                </div>
                <div className="changelog-entry-body">
                  <div className="changelog-entry-head">
                    <span className="mono changelog-version">{e.version}</span>
                    <span className="changelog-date">{e.date}</span>
                  </div>
                  <h2 className="changelog-summary">{e.summary}</h2>
                  <ul className="docs-list">
                    {e.highlights.map((h) => (
                      <li key={h.slice(0, 24)}>{h}</li>
                    ))}
                  </ul>
                  <p className="mono changelog-hash" title={e.entry_hash}>
                    seq {e.seq} · {short(e.entry_hash)} ← {e.prev_hash ? short(e.prev_hash) : "genesis"}
                  </p>
                </div>
              </article>
            ))}
          </div>
          </div>
        </section>

        <section className="mk-section">
          <div className="mk">
          <span className="mk-eyebrow">Verify it yourself</span>
          <h2 className="mk-h2">No account, no Runback software beyond one fetch.</h2>
          <div className="docs-code-block">
            <div className="docs-code-lang mono">bash</div>
            <pre className="docs-code"><code>{`curl https://runback.dev/api/changelog | node -e '
const crypto = require("crypto");
const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined)
    .map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}
let data = "";
process.stdin.on("data", c => data += c);
process.stdin.on("end", () => {
  const { entries } = JSON.parse(data);
  let prev = "";
  for (const e of entries) {
    const { seq, prev_hash, entry_hash, ...release } = e;
    if (prev_hash !== prev || sha256(prev + canonical(release)) !== entry_hash) {
      console.error("BROKEN at seq", seq); process.exit(1);
    }
    prev = entry_hash;
  }
  console.log("verified:", entries.length, "entries, chain intact");
});'`}</code></pre>
          </div>
          </div>
        </section>

        <section className="mk-section">
          <div className="mk">
          <span className="mk-eyebrow">Honest limits</span>
          <h2 className="mk-h2">What this page does not claim.</h2>
          <ul className="docs-list" style={{ maxWidth: "62ch" }}>
            <li>
              These are curated, customer-facing release notes, not a raw git log — a chain over a
              summary we wrote is not proof the summary is complete, only proof it hasn&apos;t been
              edited since it was published.
            </li>
            <li>
              There is no independent time-stamping on these entries the way there is for ledger
              checkpoints (RFC 3161 witnessing, a public transparency log). This chain proves internal
              consistency — that nothing here was silently altered — not that it existed by a given date
              beyond git&apos;s own commit history.
            </li>
          </ul>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
