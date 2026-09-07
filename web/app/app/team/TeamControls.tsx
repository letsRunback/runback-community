"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UPGRADE_HREF } from "@/lib/edition";

const ROLES = ["viewer", "member", "admin", "owner"] as const;

export function InviteForm({
  canInvite, isOwner, seatsUsed, seatLimit,
}: {
  canInvite: boolean;
  isOwner: boolean;
  /** Undefined limit = unmetered (Enterprise) — no seat UI shown at all. */
  seatsUsed?: number;
  seatLimit?: number;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  if (!canInvite) return null;

  // Disabling here is a courtesy, not the enforcement — lib/team.ts's
  // inviteMember() still checks server-side (and consumeMagicLink() again at
  // acceptance, since seats can fill between invite and click). This just
  // saves a round trip to learn what the form could already tell you.
  const seatsFull = seatLimit !== undefined && seatsUsed !== undefined && seatsUsed >= seatLimit;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "invite", email, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) { setMsg({ ok: true, text: `Invite sent to ${email}.` }); setEmail(""); router.refresh(); }
      else setMsg({ ok: false, text: data.error || "Failed." });
    } catch {
      setMsg({ ok: false, text: "Network error — try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="team-invite-wrap">
      <form className="team-invite" onSubmit={submit}>
        <input type="email" required placeholder="teammate@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={seatsFull} />
        <select value={role} onChange={(e) => setRole(e.target.value)} disabled={seatsFull}>
          {ROLES.filter((r) => isOwner || r !== "owner").map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="btn-fill" type="submit" disabled={loading || seatsFull}>{loading ? "…" : "Invite"}</button>
        {seatLimit !== undefined && seatsUsed !== undefined && (
          <span className={`team-seats mono${seatsFull ? " team-seats-full" : ""}`}>{seatsUsed} / {seatLimit} seats</span>
        )}
        {msg && <span className={msg.ok ? "team-ok" : "gs-error"} style={{ alignSelf: "center" }}>{msg.text}</span>}
      </form>
      {seatsFull && (
        <p className="team-seats-note">
          Seat limit reached. Remove a member, or{" "}
          <a href={UPGRADE_HREF} className="mk-link">upgrade your plan</a> for more seats.
        </p>
      )}
    </div>
  );
}

export function RoleControl({ userId, role, canManage, isOwner }: { userId: string; role: string; canManage: boolean; isOwner: boolean }) {
  const [val, setVal] = useState(role);
  const router = useRouter();
  if (!canManage) return <span className="mono team-role">{role}</span>;

  async function change(next: string) {
    setVal(next);
    try {
      const res = await fetch("/api/team", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "role", userId, role: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { setVal(role); alert(data.error || "Failed"); }
      else router.refresh();
    } catch {
      setVal(role);
      alert("Network error — role wasn't changed.");
    }
  }
  return (
    <select className="team-role-sel mono" value={val} onChange={(e) => change(e.target.value)}>
      {ROLES.filter((r) => isOwner || r !== "owner").map((r) => <option key={r} value={r}>{r}</option>)}
    </select>
  );
}

export function RemoveBtn({ userId, canManage }: { userId: string; canManage: boolean }) {
  const router = useRouter();
  if (!canManage) return null;
  async function remove() {
    if (!confirm("Remove this member?")) return;
    try {
      const res = await fetch("/api/team", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "remove", userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) alert(data.error || "Failed"); else router.refresh();
    } catch {
      alert("Network error — member wasn't removed.");
    }
  }
  return <button className="team-remove" onClick={remove} title="Remove">×</button>;
}

export function RevokeSessionsBtn({ userId, canManage }: { userId: string; canManage: boolean }) {
  const [busy, setBusy] = useState(false);
  if (!canManage) return null;
  async function revoke() {
    if (!confirm("Sign this member out of all their active sessions?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/team", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke_sessions", userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) alert(data.error || "Failed");
      else alert("Signed out — their next request will require signing in again.");
    } catch {
      alert("Network error — sessions weren't revoked.");
    } finally {
      setBusy(false);
    }
  }
  return <button className="team-signout" onClick={revoke} disabled={busy} title="Sign out active sessions">⏻</button>;
}
