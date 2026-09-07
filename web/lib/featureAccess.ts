/**
 * The "fetch real data if entitled, else use an illustrative fixture" pattern
 * that ~20 pages under web/app/app/** each re-implement inline — every one
 * writing its own `entitled ? await fetchX().catch(() => []) : []` line
 * (or several, for pages that fetch more than one thing).
 *
 * Deliberately does NOT decide `allowed` itself. Pages compute that however
 * they already do — some are `can(orgPlan, feature)` alone, most also OR in
 * `DEMO_MODE || isDemoEmail(email)`, and a few combine two Feature flags.
 * Centralizing that decision was tried and reverted: team/page.tsx's `rbac`
 * gate has no demo bypass at all (unlike most other gated pages), and baking
 * one in here would have silently changed its behavior on migration. Passing
 * `allowed` in keeps every page's exact gating semantics visible in its own
 * source rather than hidden inside a shared helper's assumptions.
 */

/**
 * Fetch the real thing only if `allowed` (skip the DB round-trip otherwise),
 * falling back to the fixture on denial OR on a failed fetch — matching every
 * existing page's `.catch(() => fixture)` behavior so a transient DB error
 * degrades to the illustrative view instead of a 500.
 */
export async function fetchOrFixture<T>(
  allowed: boolean,
  fixture: T,
  fetchReal: () => Promise<T>
): Promise<T> {
  if (!allowed) return fixture;
  return fetchReal().catch(() => fixture);
}
