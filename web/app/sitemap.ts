import type { MetadataRoute } from "next";
import { BLOG_POSTS } from "@/lib/blogPosts";
import { COMPETITORS } from "@/lib/competitors";
import { PUBLIC_REGULATORY_FRAMEWORK_IDS } from "@/lib/regulatoryFrameworks";
import { routeAvailable } from "@/lib/edition";

// Hard-coded so a rebuild does not claim every page changed today. Bump it when
// content genuinely changes; a lastmod that always says "now" is noise a crawler
// learns to ignore.
const NOW = new Date("2026-08-02");

// NEXT_PUBLIC_APP_URL is only present in the running container's environment
// on self-hosted deployments, not at `docker build` time (see
// docker-compose.yml) — force-dynamic below defers this read to request time
// instead of baking runback.dev in permanently via build-time prerendering.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://runback.dev";
  const marketing = [
    // /why and /proof were merged into /how-it-works and now 308. A sitemap
    // must list canonical destinations only — submitting a redirect makes
    // Search Console report it as an error and spends crawl budget landing on
    // a page that immediately sends the crawler somewhere else.
    // /docs is a top-level nav item and the largest indexable asset on the site;
    // it was absent here, so the single best page for organic search was never
    // submitted. /verify and /runs are the two things people link to from
    // outside — both are public and both were missing too.
    "", "/how-it-works", "/about", "/get-started", "/use-cases", "/onboarding",
    "/pricing", "/contact", "/enterprise", "/security", "/status", "/integrations",
    "/integrations/eaapl", "/docs", "/verify", "/runs", "/eu-ai-act", "/regulatory",
    "/changelog", "/transparency",
    "/support", "/procurement", "/vs", "/blog", "/llms.txt",
    "/press", "/demo", "/spec", "/privacy", "/terms", "/dpa",
  ];
  const regulatoryPages = PUBLIC_REGULATORY_FRAMEWORK_IDS.map((id) => `/regulatory/${id}`);
  const vsPages = Object.keys(COMPETITORS).map((slug) => `/vs/${slug}`);
  const blogPages = BLOG_POSTS.map((p) => `/blog/${p.slug}`);

  // Never advertise a route this build does not serve. The Community build
  // drops /pricing among others, and a sitemap entry pointing at a 404 is worse
  // than an omission — search engines act on it.
  return [...marketing, ...regulatoryPages, ...vsPages, ...blogPages]
    .filter((path) => routeAvailable(path || "/"))
    .map((path) => ({
    url: `${BASE}${path}`,
    lastModified: blogPages.includes(path) ? new Date(BLOG_POSTS.find((p) => `/blog/${p.slug}` === path)!.date) : NOW,
    changeFrequency: (path === "" ? "weekly" : "monthly") as "weekly" | "monthly",
    priority: path === "" ? 1 : vsPages.includes(path) || blogPages.includes(path) ? 0.8 : 0.7,
  }));
}
