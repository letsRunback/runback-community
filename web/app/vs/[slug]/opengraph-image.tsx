import { renderOgImage, OG_SIZE } from "@/lib/ogImage";
import { COMPETITORS } from "@/lib/competitors";

export const runtime = "edge";
export const alt = "Runback comparison";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = COMPETITORS[slug];

  return renderOgImage({
    eyebrow: c ? `${c.name} vs Runback` : "Compare",
    eyebrowColor: "#7c5cfc",
    title: c ? `${c.name} observes.` : "Runback",
    titleAccent: c ? "Runback re-executes." : undefined,
    subtitle: c ? c.gap : "The system of record for AI agents.",
  });
}
