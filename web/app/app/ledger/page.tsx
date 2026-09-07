import { requireSession } from "@/lib/auth";
import { effectivePlan } from "@/lib/entitlements";
import { orgHasFeature } from "@/lib/planGate";
import { DEMO_MODE, isDemoEmail } from "@/lib/demoMode";
import { ledgerStatus, type LedgerStatus } from "@/lib/ledger";
import { existingLogIdFor } from "@/lib/transparency";
import { planBadgeText } from "@/lib/plans";
import { siteUrl } from "@/lib/deployment";
import LedgerControls from "./LedgerControls";
import SampleDataEmpty from "../SampleDataEmpty";
import GateOverlay from "../GateOverlay";
import { UPGRADE_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

// Illustrative only — same reasoning as GLIMPSE_PENDING/GLIMPSE_ANOMALIES on
// the Approvals page and DEMO_ENTRY_TEMPLATES on Golden: a non-entitled org
// sees a real-shaped preview under the gate, never its own numbers. This page
// previously called `ledgerStatus(orgId, true)` for ANY non-entitled org —
// not just demo accounts — which bypasses that function's own entitlement
// assertion and fetches the org's REAL entry count, chain head, and
// checkpoint state into the page's SSR payload. The overlay only blurs it
// with CSS (pointer-events: none) — the real values were still sitting in
// the HTML, readable via view-source, for any org on a sub-Enterprise plan.
const EMPTY_STATUS: LedgerStatus = { count: 0, head: null, sealedThrough: 0, lastCheckpointAt: null, signed: false };
const GLIMPSE_STATUS: LedgerStatus = { count: 128, head: "8f2c1a9e4d7b0361f5c8a2e9d604b1f7", sealedThrough: 12, lastCheckpointAt: new Date(Date.now() - 2 * 3600_000).toISOString(), signed: true };

export default async function LedgerPage() {
  const session = await requireSession();
  // The tamper-evident ledger is an Enterprise feature (demo accounts exempt).
  const demo = DEMO_MODE || isDemoEmail(session.email);
  const allowed = demo || (await orgHasFeature(session.orgId, "ledger"));

  // Only a demo account gets a real fetch with the entitlement bypass. A real,
  // non-entitled org gets the illustrative fixture — never its own data —
  // and an entitled org gets its own real status normally.
  // `demo` implies `allowed`, so the old three-way nest collapsed to this —
  // the demo flag is just the entitlement-bypass argument, not a third branch.
  // The error fallback deliberately stays EMPTY_STATUS rather than the
  // illustrative fixture: showing invented ledger figures because a read
  // failed would be a lie about an audit record, which is the one thing this
  // page must never do.
  const status = allowed
    ? await ledgerStatus(session.orgId, demo).catch(() => EMPTY_STATUS)
    : GLIMPSE_STATUS;
  const enterprise = effectivePlan(session.rawPlan) === "enterprise";
  // Never fetched for a demo/non-entitled view — same "never a real org's
  // actual identifier under an illustrative page" rule as `status` above.
  const logId = allowed && !demo && status.count > 0 ? await existingLogIdFor(session.orgId).catch(() => null) : null;

  const head = (
    <div className="appc-head">
      <h1 className="appc-h1">Audit ledger</h1>
      <p className="appc-sub">Change one byte of one decision, anywhere in your history, and this catches it — provably, without asking you to trust us.</p>
    </div>
  );

  if (!allowed) {
    return (
      <div className="appc">
        {head}
        <GateOverlay
          badge={`Audit ledger · ${planBadgeText("ledger")}`}
          title="An org-wide, tamper-evident system of record."
          lead="Every agent decision sealed into an append-only, hash-chained ledger with signed checkpoints — change, delete, or insert any past decision and verification catches it at the exact one. Available on the Enterprise plan."
          ctaHref={UPGRADE_HREF}
          ctaLabel="Upgrade to Enterprise →"
        >
          <LedgerControls initial={status} />
          <p className="empty ledger-verify-note">
            <strong>How verification works:</strong> every run is re-derived from its current data into its leaf, the chain is
            re-linked end to end, and the recomputed head + Merkle root are checked against the latest Runback-signed checkpoint.
            A run changed after sealing fails at its exact position.
          </p>
        </GateOverlay>
      </div>
    );
  }

  return (
    <div className="appc">
      {head}

      {status.count === 0 ? (
        <SampleDataEmpty
          badge="Audit ledger · the system of record"
          title="Prove that nothing was altered — across your whole history."
          lead="Every agent decision is sealed into an append-only, hash-chained ledger. Change, delete, or insert any past decision and verification catches it at the exact one. Load sample data, then hit Verify — and try it: nothing can be faked."
          points={[
            "Append-only hash chain — every decision links to the one before",
            "Signed checkpoints anchor the head + a Merkle root",
            "Verify re-derives every record and pinpoints any tampering",
          ]}
        />
      ) : (
        <>
          <LedgerControls initial={status} />
          <p className="empty ledger-verify-note">
            <strong>How verification works:</strong> every run is re-derived from its current data into its leaf, the chain is
            re-linked end to end, and the recomputed head + Merkle root are checked against the latest Runback-signed checkpoint.
            A run changed after sealing fails at its exact position.
          </p>
          {!enterprise && (
            <p className="empty ledger-enterprise-note">
              On <strong>Enterprise</strong>: managed audit-key custody, long retention, and the SLA a regulator expects.
            </p>
          )}
          {logId && (
            <div className="ledger-badge-embed">
              <p className="ledger-badge-lead">
                <strong>Public status badge.</strong> Renders live from this ledger — the count and timestamp
                are read fresh on every view, not a static image. Drop it in your own README or trust page;
                it reveals nothing beyond &quot;this workspace has sealed N checkpoints.&quot;
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element -- a
                  live-rendered SVG with content-driven width from our own
                  API route, not a static asset next/image is built for */}
              <img src={`/api/badge/${logId}.svg`} alt="Runback public ledger status" className="ledger-badge-preview" />
              <pre className="ledger-badge-snippet mono">{`[![Runback](${siteUrl()}/api/badge/${logId}.svg)](${siteUrl()}/api/transparency?log=${logId})`}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
