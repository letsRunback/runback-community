import Link from "next/link";
import Header from "./Header";
import Footer from "./Footer";
import CassetteMark from "./CassetteMark";

export default function ArticleLayout({
  title,
  date,
  author,
  tags,
  children,
}: {
  title: string;
  date: string;
  author: string;
  tags: string[];
  children: React.ReactNode;
}) {
  const formattedDate = new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <Header />
      <main className="mk" style={{ paddingTop: "3rem", paddingBottom: "1rem" }}>
        <Link href="/blog" className="mono" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          ← Blog
        </Link>
        <CassetteMark />
        <h1
          style={{
            fontSize: "clamp(1.9rem,4vw,2.7rem)",
            letterSpacing: "-0.04em",
            margin: "1rem 0 0.6rem",
            lineHeight: 1.15,
          }}
        >
          {title}
        </h1>
        <div
          className="mono"
          style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "2.2rem" }}
        >
          <span>{author}</span>
          <span>·</span>
          <time dateTime={date}>{formattedDate}</time>
          {tags.length > 0 && (
            <>
              <span>·</span>
              <span>{tags.join(", ")}</span>
            </>
          )}
        </div>
        <article style={{ maxWidth: "70ch" }}>{children}</article>
      </main>
      <div style={{ marginTop: "3rem" }}>
        <Footer />
      </div>
    </>
  );
}
