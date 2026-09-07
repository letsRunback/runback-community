import { notFound } from "next/navigation";
import { breadcrumbLd } from "@/lib/breadcrumbs";
import type { Metadata } from "next";
import ArticleLayout from "@/components/site/ArticleLayout";
import { BLOG_POSTS, getBlogPost } from "@/lib/blogPosts";

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};
  return {
    title: `${post.title} — Runback`,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      url: `https://runback.dev/blog/${post.slug}`,
      type: "article",
      publishedTime: post.date,
    },
  };
}

export default async function BlogPost({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { "@type": "Organization", name: post.author },
    publisher: { "@type": "Organization", name: "Runback", url: "https://runback.dev" },
    keywords: post.tags.join(", "),
    url: `https://runback.dev/blog/${post.slug}`,
    mainEntityOfPage: { "@type": "WebPage", "@id": `https://runback.dev/blog/${post.slug}` },
  };

  const crumbs = breadcrumbLd([
    { name: "Runback", path: "/" },
    { name: "Blog", path: "/blog" },
    { name: post.title },
  ]);

  const { Body } = post;
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <ArticleLayout title={post.title} date={post.date} author={post.author} tags={post.tags}>
        <Body />
      </ArticleLayout>
    </>
  );
}
