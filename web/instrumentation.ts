/**
 * register() runs exactly once, when the server process starts — before any
 * request is handled. This is where we tell an operator about a
 * misconfiguration BEFORE their first customer hits it, not after.
 *
 * SSO_SECRET_KEY, MODEL_KEY_SECRET, SIEM_SECRET_KEY and WORKFLOW_SECRET_KEY
 * are all correctly optional (lib/sso.ts, lib/modelKeys.ts, lib/siem.ts,
 * lib/workflow.ts) — a deployment that never uses SSO, BYOK model keys, SIEM
 * forwarding, or ServiceNow/Jira/PagerDuty sinks genuinely doesn't need them,
 * and hard-failing boot over an unused feature would be worse than the
 * problem it solves. But "throws the first time someone tries to save an SSO
 * config, three weeks after deploy, with no earlier signal" is also a bad
 * failure mode for something that's a one-line env var fix. This logs once,
 * at boot, in `docker compose logs web` (or the hosted equivalent) — visible
 * to whoever is watching startup, not just whoever happens to click Save
 * first.
 */
function warnAboutOptionalSecretsOnce() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // once per process, not per edge invocation
  const gaps: string[] = [];
  if (!process.env.SSO_SECRET_KEY) {
    gaps.push("SSO_SECRET_KEY — Enterprise SSO (OIDC) config cannot be saved without it.");
  }
  if (!process.env.MODEL_KEY_SECRET) {
    gaps.push("MODEL_KEY_SECRET — BYOK model keys (Settings → Model Keys) cannot be saved without it.");
  }
  if (!process.env.SIEM_SECRET_KEY && !process.env.MODEL_KEY_SECRET) {
    gaps.push("SIEM_SECRET_KEY — a SIEM collector (Splunk/Sentinel) cannot be configured without it or MODEL_KEY_SECRET.");
  }
  if (!process.env.WORKFLOW_SECRET_KEY && !process.env.MODEL_KEY_SECRET) {
    gaps.push("WORKFLOW_SECRET_KEY — a ServiceNow/Jira/PagerDuty sink cannot be configured without it or MODEL_KEY_SECRET.");
  }
  if (gaps.length === 0) return;
  console.warn(
    `[startup] ${gaps.length} optional secret(s) unset — the features below will throw when first used, ` +
    `not now (generate each with: openssl rand -hex 32):\n` +
    gaps.map((g) => `  - ${g}`).join("\n")
  );
}

/**
 * Load the commercially-licensed modules that fill a seam in a Community
 * file, purely for their import side effects.
 *
 * These modules register themselves (lib/enterprise/alerts →
 * lib/alertHook), and the Community half they serve — lib/ingest.ts — must
 * not import them directly or it could not compile in a build where
 * lib/enterprise/ is absent. Something still has to load them in a build
 * where they ARE present, though, and it has to be before the first request:
 * ingest fires alerts on the run-end envelope, and the route that would
 * otherwise have pulled the module in (/api/alerts) may never be hit in that
 * process. Registering lazily at first use would make alerting silently
 * depend on which endpoint a process happened to serve first.
 *
 * The import goes through lib/enterpriseBootstrap so this file stays
 * Community: a Community build swaps that one small module for its .community
 * variant, and every seam keeps its (correct) fallback.
 */
async function registerEnterpriseModules() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { loadEnterpriseModules } = await import("@/lib/enterpriseBootstrap");
    await loadEnterpriseModules();
  } catch (e) {
    console.warn("[startup] enterprise module registration failed:", e instanceof Error ? e.message : e);
  }
}

/** Next.js calls this once per server instance, before the first request. */
export async function register() {
  warnAboutOptionalSecretsOnce();
  await registerEnterpriseModules();
}

/**
 * Server error capture.
 *
 * Next calls onRequestError for every uncaught server-side error — route
 * handlers, Server Components, middleware. Before this they went to
 * console.error and nowhere else, so the only way to learn something was
 * broken in production was for a customer to report it.
 *
 * Deliberately thin: it extracts context and hands off. Anything heavier here
 * runs on the failure path of every request, which is the worst possible place
 * to add work or another way to throw.
 */
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string; routeType?: string }
) {
  try {
    const { captureError } = await import("@/lib/errorTracking");
    await captureError(err, {
      // routePath is the parameterised form (/app/runs/[run_id]), which groups
      // far better than the concrete path — otherwise every run id looks like
      // a different fault.
      route: context.routePath || request.path || null,
      method: request.method ?? null,
      severity: "error",
    });
  } catch {
    // Never let the error reporter become the error. Next already logged the
    // original; adding a second failure here would only obscure it.
  }
}
