import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getUsage } from "@/lib/usage";
import { effectivePlan, can } from "@/lib/entitlements";
import { pendingCount } from "@/lib/approvals";
import { openCount } from "@/lib/incidents";
import { getSetupProgress } from "@/lib/onboardingProgress";
import { isDemoEmail } from "@/lib/demoMode";
import { routeAvailable, UPGRADE_HREF } from "@/lib/edition";
import NavLinks, { type NavSection } from "./NavLinks";
import AppChrome from "./AppChrome";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession().catch(() => null);
  if (!session) redirect("/login");
  // See app/not-found.tsx: proxy.ts's self-host gate redirects every
  // marketing route, including /get-started, to /login — so the demo
  // banner's CTA below must not link there when self-hosted.
  const selfHosted = !!process.env.RUNBACK_SELF_HOSTED;

  // Sidebar mini-meter (metered plans only).
  const metered = effectivePlan(session.orgPlan) !== "enterprise";
  const hasApprovals = can(session.orgPlan, "approvals");
  const hasIncidents = can(session.orgPlan, "incidents");

  const [usage, pending, incidents, setup] = await Promise.all([
    metered ? getUsage(session.orgId).catch(() => null) : Promise.resolve(null),
    hasApprovals ? pendingCount(session.orgId).catch(() => 0) : Promise.resolve(0),
    hasIncidents ? openCount(session.orgId).catch(() => 0) : Promise.resolve(0),
    getSetupProgress(session.orgId).catch(() => null),
  ]);

  // Grouped by the product's own four-phase story (see Get Started), not a
  // flat capability list — every click through the nav should reinforce
  // what the platform does, using the same phase→color mapping as the
  // Get Started jobs cards (Observe=blue, Replay=violet, Gate=amber,
  // Audit=emerald) so the convention reads consistently everywhere.
  const sections: NavSection[] = [
    ...(setup && setup.done < setup.total
      ? [{ label: "", items: [{ href: "/app/get-started", label: "Get started", badge: setup.total - setup.done }] }]
      : []),
    {
      label: "01 · Observe", tone: "blue",
      items: [
        { href: "/app",           label: "Overview"  },
        { href: "/app/runs",      label: "Runs"      },
        { href: "/app/alerts",    label: "Alerts"    },
        { href: "/app/incidents", label: "Incidents", badge: incidents || undefined },
      ],
    },
    {
      label: "02 · Replay", tone: "violet",
      items: [
        { href: "/app/prompts", label: "Prompts" },
        { href: "/app/datasets", label: "Datasets" },
        { href: "/app/evals", label: "Evals", children: [
          { href: "/app/golden", label: "Golden" },
          { href: "/app/evals/compare", label: "Compare" },
          { href: "/app/evals/calibrate", label: "Calibrate" },
        ] },
        { href: "/app/benchmark", label: "Benchmark", children: [
          { href: "/app/corpus", label: "Corpus" },
        ] },
      ],
    },
    {
      label: "03 · Gate", tone: "amber",
      items: [
        { href: "/app/policies", label: "Policies", children: [
          { href: "/app/policies/library", label: "Library" },
          { href: "/app/policies/causes",  label: "Causes"  },
        ] },
        { href: "/app/models", label: "Models", children: [
          { href: "/app/models/diff",  label: "Diff"  },
          { href: "/app/models/gate",  label: "Gate"  },
          // Drift had no inbound link anywhere in the product — a 400-line page,
          // a lib, a daily cron and a table, reachable only by typing the URL.
          { href: "/app/models/drift", label: "Drift" },
          // Same story as Drift above: bisectStoredRun + its API route existed
          // and worked, with zero UI anywhere in the product to reach it.
          { href: "/app/models/bisect", label: "Bisect" },
        ] },
        { href: "/app/approvals", label: "Approvals", badge: pending || undefined },
      ],
    },
    {
      label: "04 · Audit", tone: "emerald",
      items: [
        { href: "/app/coverage",    label: "Coverage"   },
        { href: "/app/compliance",  label: "Compliance" },
        { href: "/app/ledger",      label: "Ledger", children: [
          { href: "/app/activity", label: "Activity" },
        ] },
        { href: "/app/regulatory",  label: "Regulatory"  },
      ],
    },
    {
      label: "Workspace",
      items: [
        { href: "/app/team", label: "Team" },
        { href: "/app/cost", label: "Cost", children: [
          { href: "/app/cost/teams", label: "By team" },
        ] },
        { href: "/app/settings", label: "Settings" },
      ],
    },
  ];

  // Drop anything this build doesn't contain (Community excludes several of
  // these route directories outright). Done here rather than at each call site
  // so a newly excluded route disappears from the nav automatically instead of
  // becoming a 404 nobody notices.
  const navSections = sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => routeAvailable(item.href))
        .map((item) =>
          item.children
            ? { ...item, children: item.children.filter((c) => routeAvailable(c.href)) }
            : item
        ),
    }))
    .filter((section) => section.items.length > 0);

  const brand = (
    <Link href="/app" className="appsh-brand">
      <svg className="appsh-mark" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#0a0b0d" />
        <path d="M23 8 L23 24 L11 16 Z" fill="#e8873d" />
        <path d="M15 8 L15 24 L3 16 Z" fill="#3ecfb8" />
        <rect x="26.6" y="9" width="2.4" height="14" rx="1.2" fill="#f2f0ea" />
      </svg>
      <span>Runback</span>
    </Link>
  );

  return (
    <AppChrome brand={brand} orgName={session.orgName}
      sidebar={
        <>
        {brand}
        <div className="appsh-org">
          <div className="appsh-org-name">{session.orgName}</div>
          <div className="appsh-role mono">{session.role} · {session.trialActive ? "trial" : session.rawPlan}</div>
          {/* Not for the shared demo: that account cannot upgrade, and the demo
              banner below already carries the one CTA that makes sense for it
              ("Start free"). Without this the demo showed four competing calls
              to action on /app/usage alone — shell Upgrade, banner Start free,
              and the page's own upsell card and See-plans button. */}
          {session.rawPlan === "free" && !isDemoEmail(session.email) && (
            <Link href={UPGRADE_HREF} className="appsh-upgrade mono">Upgrade →</Link>
          )}
        </div>
        {usage && (
          <Link href="/app/usage" className="appsh-usage" data-over={usage.pctUsed >= 1 || undefined} data-warn={usage.pctUsed >= 0.8 && usage.pctUsed < 1 || undefined}>
            <div className="appsh-usage-row mono">
              <span>{usage.runs.toLocaleString()} / {usage.limit.toLocaleString()} runs</span>
              <span>{Math.round(usage.pctUsed * 100)}%</span>
            </div>
            <div className="appsh-usage-track"><div className="appsh-usage-fill" style={{ width: `${Math.min(100, usage.pctUsed * 100)}%` }} /></div>
          </Link>
        )}
        <NavLinks sections={navSections} />
        <div className="appsh-foot">
          <div className="appsh-user mono">{session.email}</div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="appsh-signout mono">Sign out</button>
          </form>
        </div>
        </>
      }
    >
      {/* One line, at the top of the shell. This was a three-line card inside the
          content column, above the <h1> on all 19 app pages — the tallest and
          brightest element on every screen, pushing the page title to y≈155. */}
      {isDemoEmail(session.email) && (
        <div className="demo-banner">
          <span><strong>Shared public demo</strong> — data resets, nothing here is private.</span>
          {!selfHosted && <a href="/get-started" className="demo-banner-cta mono">Start free →</a>}
        </div>
      )}
      {children}
    </AppChrome>
  );
}
