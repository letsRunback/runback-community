import { getAdminClient } from "@/lib/supabase/admin";

export interface SetupStep {
  id: string;
  label: string;
  done: boolean;
  manuallyDone: boolean;
  href: string | null;
  detail: string[];
}

export interface SetupProgress {
  done: number;
  total: number;
  steps: SetupStep[];
}

const STEP_DEFS: { id: string; label: string; href: string | null; detail: string[] }[] = [
  {
    id: "connect",
    label: "Connect a real agent",
    href: null, // handled in-page — the connect card is right below the checklist
    detail: [
      "Click \"Get an API key\" in the connect card below (admins only — ask one if you're not).",
      "Copy the key — it's shown once.",
      "Pick your framework's tab (Node, Python, cURL, or OTel) and copy the snippet.",
      "Paste it into your agent and run it once.",
    ],
  },
  {
    id: "policy",
    label: "Create a policy",
    href: "/app/policies",
    // This said to "describe the condition in plain language". There is no
    // natural-language input anywhere in the product: the editor takes a JSON
    // rule. Sending a new user to a screen that does not do what they were just
    // told it does is worse than sending them nowhere.
    detail: [
      "Go to Policies and start from a template, or write a rule directly.",
      "A rule is JSON — e.g. {\"op\":\"tool_arg\",\"tool\":\"issue_refund\",\"path\":\"amount\",\"cmp\":\"gt\",\"value\":500} blocks refunds over 500.",
      "Save — it's enforced on your very next run, and every block is sealed into the audit record.",
    ],
  },
  {
    id: "alert",
    label: "Set an alert",
    href: "/app/alerts",
    detail: [
      "Go to Alerts → + New alert.",
      "Pick a trigger — a run failure, an error-rate threshold, or a cost spike.",
      "Pick where it should notify you — email, Slack, or any webhook.",
      "Save.",
    ],
  },
  {
    id: "team",
    label: "Invite a teammate",
    href: "/app/team",
    detail: [
      "Go to Team → Invite.",
      "Enter their email and pick a role — admin, reviewer, or read-only.",
      "They're in as soon as they accept the invite.",
    ],
  },
];

/**
 * Live-computed setup progress, layered with a manual override table for
 * steps completed a different way (or just dismissed). There's no single
 * stored "onboarding_state" flag — this re-derives from existing tables on
 * every call, same idiom as getOrgBasic() in dashboard.ts, plus a head-only
 * read of onboarding_step_overrides.
 */
export async function getSetupProgress(orgId: string): Promise<SetupProgress> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const headCount = async (
    table: string,
    build: (q: ReturnType<typeof sb.from>) => ReturnType<typeof sb.from>
  ) => {
    const { count } = await build(
      sb.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId)
    );
    return count ?? 0;
  };

  const [runCount, policyCount, alertCount, memberCount, overridesRes] = await Promise.all([
    headCount("ad_runs", (q) => q.not("run_id", "ilike", "demo-%")),
    headCount("ad_policies", (q) => q),
    headCount("alert_rules", (q) => q),
    headCount("memberships", (q) => q),
    sb.from("onboarding_step_overrides").select("step_id").eq("org_id", orgId).then(
      (r: { data: { step_id: string }[] | null }) => r.data ?? []
    ).catch(() => [] as { step_id: string }[]),
  ]);
  const overridden = new Set(overridesRes.map((r: { step_id: string }) => r.step_id));

  const liveDone: Record<string, boolean> = {
    connect: runCount > 0,
    policy: policyCount > 0,
    alert: alertCount > 0,
    // A fresh org already has the owner as a membership row, so this only
    // counts as "done" once someone else has actually been invited.
    team: memberCount > 1,
  };

  const steps: SetupStep[] = STEP_DEFS.map((def) => {
    const manuallyDone = overridden.has(def.id);
    return { ...def, done: liveDone[def.id] || manuallyDone, manuallyDone };
  });

  return { done: steps.filter((s) => s.done).length, total: steps.length, steps };
}

export async function markStepDone(orgId: string, stepId: string): Promise<void> {
  if (!STEP_DEFS.some((d) => d.id === stepId)) throw new Error("Unknown step");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  await sb.from("onboarding_step_overrides").upsert(
    { org_id: orgId, step_id: stepId },
    { onConflict: "org_id,step_id", ignoreDuplicates: true }
  );
}
