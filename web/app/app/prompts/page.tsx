import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { listPrompts, type PromptRow } from "@/lib/prompts/prompts";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { planBadgeText } from "@/lib/plans";
import PromptEditor from "./PromptEditor";
import SampleDataEmpty from "../SampleDataEmpty";
import FeatureGate from "../FeatureGate";
import { fetchOrFixture } from "@/lib/featureAccess";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what a real prompt registry looks like, not an empty table.
const GLIMPSE_PROMPTS: PromptRow[] = [
  { id: "glimpse-1", name: "refund-decision", version: 4, template: [], model: { provider: "anthropic", model_id: "claude-sonnet-4-6" }, params: {}, variables: [], commit_message: null, created_by: null, created_at: new Date(Date.now() - 2 * 86400_000).toISOString() },
  { id: "glimpse-2", name: "support-agent", version: 11, template: [], model: { provider: "openai", model_id: "gpt-4o" }, params: {}, variables: [], commit_message: null, created_by: null, created_at: new Date(Date.now() - 6 * 86400_000).toISOString() },
];

export default async function PromptsPage() {
  const session = await requireSession();
  const demo = DEMO_MODE || isDemoEmail(session.email);
  // Trial-aware effective plan (session.orgPlan), not the raw orgs.plan column —
  // that column stays "free" for the whole trial, which would deny a trialing org
  // the very features its trial grants.
  const allowed = demo || can(session.orgPlan, "quality");

  const prompts = await fetchOrFixture(allowed, GLIMPSE_PROMPTS, () => listPrompts(session.orgId));

  const body = (
    <div className="appc">
      <div className="appc-head">
        <h1 className="appc-h1">Prompts</h1>
        <p className="appc-sub">Versioned prompt templates your agents fetch at runtime — never a hardcoded string.</p>
      </div>

      {prompts.length === 0 && (
        <div className="policies-empty-wrap">
          <SampleDataEmpty
            badge="Prompts · the source of truth"
            title="One place your prompts actually live."
            lead="Every save is an immutable version. A label — production, staging, or anything you name — points at the version your agents fetch, so you can edit and test without touching what's live."
            points={[
              "GET /api/prompts/:name?label=production — every language, zero SDK required",
              "Move the production label only with admin access, fully audited",
              "Test a version's real output in the playground before it ships",
            ]}
          />
        </div>
      )}

      {prompts.length > 0 && (
        <div className="table-wrap policies-table-wrap">
          <table className="appc-table">
            <thead><tr><th>Prompt</th><th>Latest</th><th>Model</th><th>Updated</th></tr></thead>
            <tbody>
              {prompts.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/app/prompts/${encodeURIComponent(p.name)}`} className="appc-link mono">{p.name}</Link></td>
                  <td className="mono appc-dim">v{p.version}</td>
                  <td className="mono appc-dim">{p.model.model_id}</td>
                  <td className="mono appc-dim">{new Date(p.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {allowed && (
        <>
          <div className="dash-panel-h">New prompt / version</div>
          <PromptEditor />
        </>
      )}
    </div>
  );

  return (
    <FeatureGate
      allowed={allowed}
      badge={`Prompts · ${planBadgeText("quality")}`}
      title="Version every prompt your agents run."
      lead="A versioned registry with movable labels (production/staging), a runtime-fetch endpoint agents pull from directly, and a playground to test changes before they ship."
      ctaHref={UPGRADE_HREF}
      ctaLabel="Upgrade →"
      secondaryHref="/contact?subject=prompts"
      secondaryLabel="Talk to us"
    >
      {body}
    </FeatureGate>
  );
}
