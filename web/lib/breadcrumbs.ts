/**
 * BreadcrumbList structured data.
 *
 * Affects how a result DISPLAYS in search — Google renders the trail in place
 * of the raw URL — rather than how it ranks. Worth having on nested pages
 * because "Runback › Compare › LangSmith" reads as a section of a real site,
 * where a bare URL reads as a loose page.
 *
 * Only for pages with genuine hierarchy. Emitting a breadcrumb on a top-level
 * page describes a structure that does not exist, and structured data that
 * contradicts the page is worse than none.
 */
const BASE = "https://runback.dev";

export interface Crumb {
  name: string;
  /** Path from the site root. Omit on the final crumb — the current page. */
  path?: string;
}

export function breadcrumbLd(crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      // The last item is the current page and carries no item URL, per
      // Google's guidance — self-linking the final crumb is a common way to
      // get the markup flagged as invalid.
      ...(c.path ? { item: `${BASE}${c.path}` } : {}),
    })),
  };
}
