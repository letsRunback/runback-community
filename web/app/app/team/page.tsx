import { requireSession, atLeast } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { planBadgeText } from "@/lib/plans";
import { listMembers, type Member } from "@/lib/team";
import { seatStatus } from "@/lib/seats";
import { fetchOrFixture } from "@/lib/featureAccess";
import { InviteForm, RoleControl, RemoveBtn, RevokeSessionsBtn } from "./TeamControls";
import SampleDataEmpty from "../SampleDataEmpty";
import FeatureGate from "../FeatureGate";

export const dynamic = "force-dynamic";

// Illustrative only — shown blurred under the gate so a non-entitled org sees
// what a working team list looks like, not an empty table.
const GLIMPSE_MEMBERS: Member[] = [
  { userId: "g1", email: "you@yourcompany.com", name: "You", role: "owner" },
  { userId: "g2", email: "sam@yourcompany.com", name: "Sam", role: "admin" },
  { userId: "g3", email: "priya@yourcompany.com", name: "Priya", role: "member" },
];

export default async function Team({ searchParams }: { searchParams: Promise<{ seat_limit?: string }> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const seatLimitFromInvite = sp.seat_limit === "1";

  // Team / RBAC is a Pro+ feature. Free = single workspace (just you).
  const entitled = can(session.orgPlan, "rbac");
  const canManage = atLeast(session.role, "admin");
  const isOwner = session.role === "owner";

  // GateOverlay (rendered by FeatureGate below) only blurs its children with
  // CSS — they're fully present in the HTML. A non-entitled org must always
  // get the illustrative fixture here, never its own real member list,
  // however many members it has.
  const members = await fetchOrFixture(entitled, GLIMPSE_MEMBERS, () => listMembers(session.orgId));
  const seats = await fetchOrFixture(entitled, null, () => seatStatus(session.orgId));

  const body = (
    <>
      {seatLimitFromInvite && (
        <div className="runs-welcome-banner">
          <span className="runs-welcome-icon" data-warn>!</span>
          <div className="runs-welcome-body">
            <strong>An invite couldn&apos;t be completed.</strong>{" "}
            The workspace you were invited to had no seats left when you clicked the link — you&apos;re signed in here instead. Ask that workspace&apos;s owner or admin to remove a member or upgrade the plan, then ask for a fresh invite.
          </div>
        </div>
      )}

      {entitled && members.length <= 1 && (
        <div className="team-empty-wrap">
          <SampleDataEmpty
            seed={false}
            badge="Team · roles & access"
            title="Bring your team in — with the right access."
            lead="Invite teammates and give each the access they need. Roles run owner › admin › member › viewer, so an auditor can read everything while only admins change settings or billing."
            points={[
              "Owner & admin manage settings, billing, and the team",
              "Members run and inspect agents; viewers get read-only",
              "Invites are scoped to your workspace, revocable anytime",
            ]}
            foot={canManage ? "Invite your first teammate with the form below." : "Ask an admin to invite teammates."}
          />
        </div>
      )}

      <InviteForm
        canInvite={entitled && canManage}
        isOwner={isOwner}
        seatsUsed={seats && seats.limit !== Infinity ? seats.used : undefined}
        seatLimit={seats && seats.limit !== Infinity ? seats.limit : undefined}
      />

      <div className="table-wrap team-table-wrap">
        <table className="appc-table">
          <thead><tr><th>Member</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => {
              // An admin can manage members below owner, but never an owner
              // themselves — otherwise the role-select/remove controls on a
              // co-owner's row would look actionable to an admin even though
              // the API correctly refuses the mutation (lib/team.ts).
              const rowCanManage = entitled && canManage && (m.role !== "owner" || isOwner);
              return (
              <tr key={m.email}>
                <td>
                  <span className="mono">{m.email}</span>
                  {m.pending && <span className="team-pending">pending</span>}
                  {m.email === session.email && <span className="team-you">you</span>}
                </td>
                <td>
                  {m.pending || m.email === session.email ? (
                    <span className="mono team-role">{m.role}</span>
                  ) : (
                    <RoleControl userId={m.userId} role={m.role} canManage={rowCanManage} isOwner={isOwner} />
                  )}
                </td>
                <td className="team-actions-cell">
                  {!m.pending && m.email !== session.email && (
                    <>
                      <RevokeSessionsBtn userId={m.userId} canManage={rowCanManage} />
                      <RemoveBtn userId={m.userId} canManage={rowCanManage} />
                    </>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <div className="appc">
      <div className="appc-head">
        <h1 className="appc-h1">Team</h1>
        <p className="appc-sub">
          {entitled ? (
            <>
              Who&apos;s in — and what each can touch. <span className="mono">owner › admin › member › viewer</span>.
              {!canManage && " Ask an admin to make changes."}
            </>
          ) : (
            "Your workspace is single-user on the free plan."
          )}
        </p>
      </div>

      <FeatureGate
        allowed={entitled}
        badge={planBadgeText("rbac")}
        title="Bring your team"
        lead="Invite teammates with roles — owner, admin, member, viewer — so your whole team shares one governed workspace. On Pro and Enterprise."
        secondaryHref="/contact"
        secondaryLabel="Talk to us"
      >
        {body}
      </FeatureGate>
    </div>
  );
}
