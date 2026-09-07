import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { planBadgeText } from "@/lib/plans";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import CostTeamsClient, { type Team, type AgentRule } from "./CostTeamsClient";
import { DEMO_CHARGEBACK } from "../page";
import GateOverlay from "../../GateOverlay";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what real team chargeback setup looks like, not an empty form.
const DEMO_TEAMS: Team[] = DEMO_CHARGEBACK.by_team.map((r) => r.team);
const DEMO_RULES: AgentRule[] = [
  { id: "gr1", team_id: "t1", prefix: "loan-" },
  { id: "gr2", team_id: "t1", prefix: "kyc-" },
  { id: "gr3", team_id: "t2", prefix: "fraud-" },
  { id: "gr4", team_id: "t3", prefix: "report-" },
  { id: "gr5", team_id: "t4", prefix: "data-" },
];

export default async function CostTeamsPage() {
  const session = await getSession();
  if (!session) notFound();

  const demo = DEMO_MODE || isDemoEmail(session.email);
  // Trial-aware effective plan, not the raw orgs.plan column (which stays "free"
  // for the whole trial and would gate a trialing org out of its own trial).
  const allowed = demo || can(session.orgPlan, "chargeback");

  if (!allowed) {
    return (
      <GateOverlay
        badge={`Chargeback · ${planBadgeText("chargeback")}`}
        title="Per-team cost attribution with budget caps."
        lead="Define teams, assign agents by prefix, and set monthly spend caps. Every model call is attributed to the right team automatically. Available on Enterprise."
        ctaHref={UPGRADE_HREF}
        ctaLabel="Upgrade →"
        secondaryHref="/contact?subject=chargeback"
        secondaryLabel="Talk to us"
      >
        <CostTeamsClient demoTeams={DEMO_TEAMS} demoRules={DEMO_RULES} />
      </GateOverlay>
    );
  }

  return <CostTeamsClient />;
}
