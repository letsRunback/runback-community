import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getUsage } from "@/lib/usage";
import { effectivePlan } from "@/lib/entitlements";
import { planBadgeText } from "@/lib/plans";
import { isDemoEmail } from "@/lib/demoMode";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

const fmt = (n: number) => (n === Infinity ? "∞" : n.toLocaleString());

export default async function UsagePage() {
  const session = await requireSession();
  const u = await getUsage(session.orgId).catch(() => null);
  // One clock read for the whole render. Reading Date.now() separately per
  // derived value let two countdowns on the same page straddle a midnight
  // boundary and disagree. react-hooks/purity flags any clock read during
  // render; that rule models client components, and this is a request-scoped
  // async Server Component where reading the clock is the entire point.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const onTrial = session.trialActive;
  const trialDays = session.trialEndsAt ? Math.max(0, Math.ceil((new Date(session.trialEndsAt).getTime() - now) / 86400_000)) : 0;
  const plan = onTrial ? "trial" : effectivePlan(session.rawPlan);
  // The demo account's trial_ends_at is deliberately pinned ~100 years out
  // (lib/seedDemo.ts) so the public demo never hits a paywall — that internal
  // sentinel must never surface as a literal day count in the UI.
  const isDemo = isDemoEmail(session.email);
  const trialLabel = isDemo ? "demo — never expires" : `${trialDays} day${trialDays === 1 ? "" : "s"} left`;
  // trialLabel reads as a duration ("12 days left") in every non-demo case, so
  // headings that append it produced "Keep everything — demo — never expires"
  // for the demo account, directly above copy about the trial ending. The demo
  // never expires, so it gets no urgency heading and no countdown at all.

  if (!u) {
    return (
      <div className="appc">
        <div className="appc-head"><h1 className="appc-h1">Usage</h1></div>
        <p className="empty">Could not load usage.</p>
      </div>
    );
  }

  const unmetered = u.limit === Infinity;
  const pct = Math.round(u.pctUsed * 100);
  const state = unmetered ? "ok" : u.pctUsed >= 1 ? "over" : u.pctUsed >= 0.8 ? "warn" : "ok";
  const daysToReset = Math.max(0, Math.ceil((new Date(u.resetsOn).getTime() - now) / 86400_000));

  return (
    <div className="appc">
      <div className="appc-head appc-head-row">
        <div>
          <h1 className="appc-h1">Usage</h1>
          <p className="appc-sub">
            This month ({u.period}) ·{" "}
            {onTrial ? <span className="mono">Trial — {trialLabel}</span> : <>the <span className="mono">{plan}</span> plan</>}
          </p>
        </div>
        {plan !== "enterprise" && <Link href={UPGRADE_HREF} className="btn-fill usage-upgrade-btn">Upgrade →</Link>}
      </div>

      {/* Runs meter */}
      <section className="usage-meter" data-state={state}>
        <div className="usage-meter-top">
          <div>
            <div className="usage-meter-label">Agent runs</div>
            <div className="usage-meter-v">
              <span className="usage-meter-now">{fmt(u.runs)}</span>
              <span className="usage-meter-lim mono">/ {fmt(u.limit)} this month</span>
            </div>
          </div>
          {!unmetered && <div className="usage-meter-pct mono">{pct}%</div>}
        </div>
        {unmetered ? (
          <p className="usage-unmetered">Unmetered — no run cap on Enterprise.</p>
        ) : (
          <>
            <div className="usage-track">
              <div
                className="usage-fill"
                data-over={pct > 100 ? "true" : undefined}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            {state === "over" && (
              <div className="usage-over-badge">
                +{Math.max(0, pct - 100)}% over limit — new runs are paused
              </div>
            )}
            <div className="usage-meter-foot">
              {state === "over" ? (
                <span className="usage-foot-bad">Upgrade or wait for the period to reset.</span>
              ) : state === "warn" ? (
                <span className="usage-foot-warn">{fmt(u.limit - u.runs)} runs left — close to the cap.</span>
              ) : (
                <span className="appc-dim">{fmt(u.limit - u.runs)} runs remaining</span>
              )}
              <span className="appc-dim mono">resets in {daysToReset}d · {u.resetsOn}</span>
            </div>
          </>
        )}
      </section>

      {/* Other limits */}
      <div className="usage-cards">
        <div className="usage-card">
          <div className="usage-card-k">Data retention</div>
          <div className="usage-card-v">{u.retentionDays === Infinity ? "Unlimited" : `${u.retentionDays} days`}</div>
          <div className="usage-card-sub appc-dim">{u.retentionDays === Infinity ? "kept indefinitely" : "older runs are pruned automatically"}</div>
        </div>
        <div className="usage-card">
          <div className="usage-card-k">Seats</div>
          <div className="usage-card-v">
            {u.seats === Infinity ? fmt(u.seats) : `${u.seatsUsed} / ${fmt(u.seats)}`}
          </div>
          <div className={`usage-card-sub${u.seats !== Infinity && u.seatsUsed >= u.seats ? " usage-foot-warn" : " appc-dim"}`}>
            {u.seats === Infinity
              ? "unlimited team members"
              : u.seatsUsed >= u.seats
                ? "at limit — invites are paused"
                : "team members"}
          </div>
        </div>
        <div className="usage-card">
          <div className="usage-card-k">Plan</div>
          <div className="usage-card-v usage-card-v-capitalize">{onTrial ? "Trial" : plan}</div>
          <div className="usage-card-sub appc-dim">{onTrial ? (isDemo ? "all features · demo workspace" : `all features · ${trialLabel}`) : plan === "free" ? "dev tools" : plan === "starter" ? "managed hosting + team" : plan === "growth" ? "golden corpus + evals" : plan === "scale" ? "fleet visibility + policy control" : plan === "pro" ? "full platform + SLA" : "in your perimeter"}</div>
        </div>
      </div>

      {(plan === "free" || onTrial) && (
        <div className="upsell usage-upsell-section">
          <div className="upsell-badge mono">{onTrial ? "Your trial" : planBadgeText("dashboard")}</div>
          <h2>{!onTrial ? "Need more headroom?" : isDemo ? "Everything, unlocked" : `Keep everything — ${trialLabel}`}</h2>
          <p>{onTrial
            ? isDemo
              ? "This demo workspace has the full platform enabled so you can look around. Nothing here expires, and nothing you do affects a real workspace."
              : "You have the full platform on trial. Upgrade to keep the dashboard, team roles, alerting, and your headroom when it ends."
            : "Pro lifts you to 100,000 runs/month, 90-day retention, 25 seats — plus the dashboard, team roles, and alerting. Enterprise is unmetered, in your perimeter."}</p>
          {/* The demo can't upgrade, and the shell banner already offers
              "Start free" — a second, differently-worded CTA here just
              competes with it. Real trials still get the buttons. */}
          {!isDemo && (
            <div className="hero-cta"><Link href={UPGRADE_HREF} className="btn-fill">See plans →</Link><Link href="/contact" className="btn-line">Talk to us</Link></div>
          )}
        </div>
      )}
    </div>
  );
}
