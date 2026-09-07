import Link from "next/link";
import { breadcrumbLd } from "@/lib/breadcrumbs";
import { notFound } from "next/navigation";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import type { Metadata } from "next";
import { COMPETITORS } from "@/lib/competitors";
import { PRICING_HREF } from "@/lib/edition";

export function generateStaticParams() {
  return Object.keys(COMPETITORS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = COMPETITORS[slug];
  if (!c) return {};
  return {
    title: `${c.name} vs Runback`,
    description: `${c.pitch} ${c.gap} See the full capability comparison.`,
    keywords: c.searchTerms,
    alternates: { canonical: `/vs/${slug}` },
    openGraph: {
      title: `${c.name} vs Runback — the re-execution gap`,
      description: `${c.pitch} ${c.gap}`,
      url: `https://runback.dev/vs/${slug}`,
    },
  };
}

function Cell({ v }: { v: "y" | "n" | "~" }) {
  if (v === "y") return <span className="cmp-cell" data-v="y">✓</span>;
  if (v === "n") return <span className="cmp-cell" data-v="n">✗</span>;
  return <span className="cmp-cell" data-v="~">partial</span>;
}

export default async function VsSlug({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = COMPETITORS[slug];
  if (!c) notFound();

  const crumbs = breadcrumbLd([
    { name: "Runback", path: "/" },
    { name: "Compare", path: "/vs" },
    { name: `${c.name} vs Runback` },
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <Header />

      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">{c.name} vs Runback</span>
          {/* A real visual anchor for a page that's otherwise a table: two
              monogram badges standing in for logos we can't legally reuse,
              with the "VS" between them as the page's actual thesis. */}
          <div className="vs-badge-row">
            <span className="vs-badge" style={{ background: "var(--text-tertiary)" }}>{c.name[0]}</span>
            <span className="vs-badge-vs mono">VS</span>
            <span className="vs-badge" style={{ background: "var(--brand)" }}>R</span>
          </div>
          <h1 className="hero-h1" style={{ maxWidth: "20ch" }}>
            {c.name} observes. <span className="accent">Runback re-executes.</span>
          </h1>
          <p className="hero-lead" style={{ maxWidth: "62ch" }}>
            {c.pitch} {c.gap}
          </p>
          <div className="hero-cta">
            <Link href="/runs" className="btn-fill">Open a live run →</Link>
            <Link href="/vs" className="btn-line">See the full field →</Link>
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk">
          <div className="table-scroll">
            <table className="ptab ptab-prose" style={{ minWidth: 580 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Capability</th>
                  <th style={{ textAlign: "center" }}>{c.name}</th>
                  <th style={{ textAlign: "center" }} className="ptab-feat">Runback</th>
                  <th style={{ textAlign: "left" }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map(([cap, them, us, note]) => (
                  <tr key={cap}>
                    <td>{cap}</td>
                    <td style={{ textAlign: "center" }}><Cell v={them} /></td>
                    <td style={{ textAlign: "center" }} className="ptab-feat"><Cell v={us} /></td>
                    <td style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "1.4rem", padding: "1rem 1.2rem", background: "rgba(79,156,249,0.05)", border: "1px solid rgba(79,156,249,0.14)", borderRadius: 10, maxWidth: 680 }}>
            <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {c.closingNote ?? `${c.gap} Most teams use both — ${c.name} for what it's already good at, Runback for the incident replay, CI gate, and signed record it doesn't do.`}
            </p>
          </div>
        </div>
      </section>

      <section className="mk-cta-band">
        <div className="mk">
          <h2>Try the replay on a real incident.</h2>
          <p>No signup. Walk a failing production run step by step and see what the model saw.</p>
          <div className="hero-cta" style={{ justifyContent: "center" }}>
            <Link href="/runs" className="btn-fill">Open a live run →</Link>
            <Link href={PRICING_HREF} className="btn-line">See pricing</Link>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
