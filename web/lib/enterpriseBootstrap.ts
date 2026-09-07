/**
 * Community build's replacement for lib/enterpriseBootstrap.ts — swapped in
 * over it by scripts/verify-community-build.sh (and, in Phase 5, by the
 * extraction itself).
 *
 * There is nothing to load: a Community build has no lib/enterprise/, so
 * every seam keeps its fallback. Those fallbacks are the correct behaviour,
 * not degraded stand-ins — lib/alertHook's no-op is right when there is no
 * alerting feature to fire.
 */
export async function loadEnterpriseModules(): Promise<void> {
  /* no enterprise modules in this build */
}
