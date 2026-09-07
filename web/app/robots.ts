import type { MetadataRoute } from "next";

// NEXT_PUBLIC_APP_URL is only present in the running container's environment
// on self-hosted deployments, not at `docker build` time (see
// docker-compose.yml) — force-dynamic defers the read below to request time
// instead of baking runback.dev in permanently via build-time prerendering.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://runback.dev";
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/exec.html", "/exec-unlock", "/app/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
