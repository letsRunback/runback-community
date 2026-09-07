import { renderOgImage, OG_SIZE } from "@/lib/ogImage";
import { getBlogPost } from "@/lib/blogPosts";

export const runtime = "edge";
export const alt = "Runback blog";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getBlogPost(slug);

  return renderOgImage({
    eyebrow: "Runback blog",
    title: post?.title ?? "Runback",
    subtitle: post?.description ?? "The system of record for AI agents.",
  });
}
