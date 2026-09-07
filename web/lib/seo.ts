import type { Metadata } from "next";
import { siteUrl } from "@/lib/deployment";

// Every caller uses this as a static `export const metadata = pageMetadata(...)`
// object, which Next.js evaluates once at build time — so on a self-hosted
// deployment where the Docker image is built before NEXT_PUBLIC_APP_URL is
// known (docker-compose.yml passes it at `up`, not `build`), this still bakes
// in the "https://runback.dev" fallback rather than the real self-host origin.
// app/layout.tsx's root metadata avoids this by reading siteUrl() inside
// generateMetadata() (a per-request function) instead of a static object;
// doing the same for every page here would be a much larger change than this
// pass's scope. The effect is limited to OG/canonical URLs looking wrong when
// a self-hosted page is shared externally — the pages themselves render fine.
const SITE_URL = siteUrl();

/**
 * Builds page metadata with an explicit openGraph/twitter block.
 *
 * Next.js merges metadata by top-level key, not deep-merging — a page that
 * sets only `title`/`description` still inherits the root layout's static
 * `openGraph` object (homepage title, homepage description, homepage url)
 * verbatim. Every marketing page should call this instead of exporting a
 * bare `{ title, description }` object so its social/Slack preview actually
 * matches the page being shared.
 */
export function pageMetadata(input: {
  title: string;
  description?: string;
  path: string;
  robots?: Metadata["robots"];
  alternates?: Omit<NonNullable<Metadata["alternates"]>, "canonical">;
  ogType?: "website" | "article";
}): Metadata {
  const { title, description, path, robots, alternates, ogType = "website" } = input;
  const url = `${SITE_URL}${path}`;

  const meta: Metadata = {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: path, ...alternates },
    openGraph: {
      type: ogType,
      siteName: "Runback",
      url,
      title,
      ...(description ? { description } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      ...(description ? { description } : {}),
    },
  };
  if (robots) meta.robots = robots;
  return meta;
}
