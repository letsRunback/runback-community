import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";
import { allBlogPostsSortedByDate } from "@/lib/blogPosts";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/blog",
  title: "Blog",
  description: "Engineering notes and governance explainers from the team building Runback.",
  alternates: {
    types: { "application/rss+xml": "https://runback.dev/feed.xml" },
  },
});

// Tag colors reuse existing semantic tokens — a reader scanning the grid can
// tell an engineering deep-dive from a compliance explainer before reading
// the title, the same way the regulatory category colors work elsewhere.
const TAG_COLOR: Record<string, string> = {
  engineering: "var(--blue)",
  determinism: "var(--blue)",
  architecture: "var(--blue)",
  product: "var(--brand)",
  policy: "var(--brand)",
  debugging: "var(--brand)",
  compliance: "var(--brand-2)",
  security: "var(--rose)",
  integrations: "var(--violet)",
  "getting-started": "var(--violet)",
};

export default function Blog() {
  const posts = allBlogPostsSortedByDate();

  return (
    <>
      <Header />

      <section className="hero">
        <div className="mk">
          <span className="mk-eyebrow">Blog</span>
          <h1 className="hero-h1" style={{ maxWidth: "22ch" }}>
            Engineering notes and <span className="accent">governance explainers</span>.
          </h1>
          <p className="hero-lead" style={{ maxWidth: "62ch" }}>
            What we&apos;re proving, how the replay engine actually works, and what it means for
            teams that need to show their work.
          </p>
          <div className="hero-cta">
            <a href="/feed.xml" className="btn-line">Subscribe via RSS →</a>
          </div>
        </div>
      </section>

      <section className="mk-section">
        <div className="mk">
          <div className="blog-card-grid">
            {posts.map((p) => {
              const color = TAG_COLOR[p.tags[0]] ?? "var(--brand)";
              return (
                <Link key={p.slug} href={`/blog/${p.slug}`} className="blog-card" style={{ borderTopColor: color }}>
                  <span className="blog-card-tag mono" style={{ color }}>{p.tags[0]}</span>
                  <span className="blog-card-title">{p.title}</span>
                  <span className="blog-card-desc">{p.description}</span>
                  <span className="blog-card-meta mono">
                    {p.author} · {new Date(p.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
