/**
 * Multi-tenant auth + RBAC foundation.
 *
 * Passwordless magic-link login (email via Resend) → an httpOnly session cookie.
 * A logged-in user belongs to one or more orgs (the tenant boundary) with a role.
 * No external auth provider, so it works the same self-hosted as hosted.
 */
import crypto from "crypto";
import { redirect } from "next/navigation";
import { cache } from "react";
import { cookies } from "next/headers";
import { getAdminClient } from "@/lib/supabase/admin";
import { mustWrite } from "@/lib/supabase/write";
import { featurePlan, trialActive } from "@/lib/entitlements";
import { seatStatus } from "@/lib/seats";

export type Role = "owner" | "admin" | "member" | "viewer";
export const ROLE_RANK: Record<Role, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };
export function atLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

// Always use __Host- prefix and Secure=true. HTTP self-host deployments must
// terminate TLS upstream (e.g., Caddy). Silently downgrading the cookie on
// any http:// URL would transmit 30-day session tokens over plaintext HTTP.
const SESSION_COOKIE = "__Host-rb_session";
const SESSION_DAYS = 30;
const MAGIC_MINUTES = 30;
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface SessionUser {
  userId: string;
  email: string;
  name: string | null;
  orgId: string;
  orgName: string;
  orgPlan: string;       // EFFECTIVE feature plan (trial-aware) — use for can()
  rawPlan: string;       // the actual paid plan on the org
  trialEndsAt: string | null;
  trialActive: boolean;
  subscriptionStatus: string | null;
  subscriptionEndsAt: string | null;
  role: Role;
}

/* ── provisioning ─────────────────────────────────────────────────────────── */

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
}

/**
 * Domains where sharing an email provider implies nothing about sharing an
 * employer. Joining an org by domain is safe for a company domain and a data
 * breach for these: the first gmail.com signup would own an org that every
 * later gmail.com user silently joined, exposing each other's runs.
 *
 * Deliberately a denylist of the large consumer providers rather than an
 * attempt to detect "corporate" — the failure mode of a missing entry is a
 * wrong join, so keep it broad and add to it rather than getting clever.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "ymail.com", "rocketmail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "gmx.com", "gmx.net", "web.de",
  "mail.com", "mail.ru", "yandex.com", "yandex.ru", "zoho.com", "proton.me",
  "protonmail.com", "pm.me", "tutanota.com", "fastmail.com", "hey.com",
  "qq.com", "163.com", "126.com", "naver.com", "hanmail.net", "daum.net",
  "bigpond.com", "optusnet.com.au", "iinet.net.au", "comcast.net", "verizon.net",
  "sbcglobal.net", "btinternet.com", "orange.fr", "free.fr", "libero.it",
  // Disposable/throwaway providers — never a shared workspace.
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "yopmail.com",
  "temp-mail.org", "trashmail.com", "sharklasers.com", "getnada.com",
]);

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

/**
 * Does `slug` belong to the org auto-created for this exact email domain?
 *
 * Org slugs are "<slugified-domain>-<4 hex>". The candidates are fetched with a
 * LIKE prefix, which is too loose on its own: "acme-com-%" also matches
 * acme.com.au's "acme-com-au-1f2e", which would drop a user into a different
 * company's workspace. Requiring the remainder to be exactly the generated
 * suffix keeps the match inside one domain.
 */
export function orgSlugMatchesDomain(domain: string, slug: string): boolean {
  const base = slugify(domain);
  return new RegExp(`^${base}-[0-9a-f]{4}$`).test(slug);
}

/** Get-or-create a user by email; returns the user id (no org). */
export async function ensureUser(email: string, name?: string): Promise<string> {
  const sb = db();
  email = email.trim().toLowerCase();
  const { data: user } = await sb.from("users").select("id").eq("email", email).maybeSingle();
  if (user) return user.id as string;
  const { data: ins } = await sb.from("users").insert({ email, name: name ?? null }).select("id").single();
  return ins.id as string;
}

/**
 * Attach a user to an existing org with a role (SSO / invite provisioning).
 *
 * `ignoreDuplicates` — an EXISTING membership's role is left untouched. This
 * is the SSO callback's only provisioning call, made on every login with
 * org.sso_default_role: a plain upsert (no ignoreDuplicates) overwrites role
 * unconditionally, so every SSO sign-in silently reset the user back to the
 * org's default role — an owner who signs in through their own org's SSO got
 * demoted to "member" on their very next login, and a member an admin had
 * deliberately demoted (e.g. after an incident) could undo that demotion
 * just by logging out and back in, if sso_default_role sat at or above their
 * demoted role. Matches the same ignoreDuplicates pattern scimSetActive()
 * already uses in lib/scim.ts for the identical "re-provision, don't clobber
 * an existing role" case. Role changes belong to Settings → Team / SCIM, not
 * to re-authenticating.
 */
/**
 * Returns whether the caller is (now, or already was) a real member — false
 * only means "seat limit reached, nothing was attached". The SSO callback
 * (this function's only caller) must check this before creating a session:
 * createSession() doesn't itself verify a memberships row exists, so calling
 * it anyway would mint a working session for an org the user was just
 * refused a seat in — a session claiming access the database doesn't back.
 */
export async function attachMembership(orgId: string, userId: string, role: Role): Promise<boolean> {
  const sb = db();
  // Seat enforcement must never reach an EXISTING member — this runs on every
  // SSO login, so checking availability before confirming they're not already
  // provisioned would start locking out an org's own existing users the
  // moment it reached its seat cap for any other reason (a plan downgrade,
  // other invites accepted).
  const { data: existing } = await sb
    .from("memberships").select("org_id").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (existing) return true;

  const seats = await seatStatus(orgId);
  if (!seats.available) return false;

  await mustWrite(
    db().from("memberships").upsert(
      { org_id: orgId, user_id: userId, role },
      { onConflict: "org_id,user_id", ignoreDuplicates: true }
    ),
    "attach membership"
  );
  return true;
}

/** Get-or-create a user, and ensure they have at least one org (as owner). */
export async function ensureUserAndOrg(email: string, name?: string): Promise<{ userId: string; orgId: string }> {
  const sb = db();
  email = email.trim().toLowerCase();

  // Upsert avoids a TOCTOU race where two concurrent magic-link clicks for the same
  // email both find no row and both try to INSERT (one would fail with a unique violation).
  const { data: upserted } = await sb
    .from("users")
    .upsert({ email, name: name ?? null }, { onConflict: "email", ignoreDuplicates: true })
    .select("id");
  const userId: string = upserted?.length
    ? upserted[0].id
    : (await sb.from("users").select("id").eq("email", email).single()).data.id;

  // Oldest membership wins, deterministically. `limit(1)` with no ORDER BY
  // returns an arbitrary row, so the moment anyone belongs to two orgs — an
  // invite, a second workspace — the org they land in after sign-in is
  // whichever Postgres happened to return, and it can differ between logins.
  const { data: memb } = await sb
    .from("memberships").select("org_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (memb && memb.length) return { userId, orgId: memb[0].org_id };

  const domain = email.split("@")[1] || "";
  const base = slugify(domain || email.split("@")[0]);

  // Someone from a company whose colleagues already use Runback should land in
  // THEIR workspace, not a second empty one. Every signup used to create its own
  // org, so two people at the same company got two isolated orgs displayed under
  // the same name (both "accenture"), unable to see each other's work or tell
  // the two apart.
  //
  // Never for consumer mail domains: "everyone with a gmail.com address joins
  // the first gmail org" would hand strangers each other's runs. Corporate
  // domains are a deliberate trust assumption — anyone who can receive mail at
  // the domain gets in — which is the same assumption the SSO domain mapping
  // already makes, but it must never extend to shared public providers.
  if (domain && !isPublicEmailDomain(domain)) {
    const { data: sameDomain } = await sb
      .from("orgs").select("id, slug").like("slug", `${base}-%`).order("created_at");
    const existing = (sameDomain ?? []).find((o: { slug: string }) => orgSlugMatchesDomain(domain, o.slug));
    if (existing) {
      // A colleague's org that's full falls through to the "create a new org"
      // branch below rather than failing sign-in outright — the alternative
      // is a corporate-domain user who can never sign in at all until an
      // admin frees a seat, for a workspace they haven't even seen yet. They
      // land in their own workspace instead; an admin can invite them into
      // the shared one later once there's room.
      const seats = await seatStatus(existing.id as string);
      if (seats.available) {
        await mustWrite(
          sb.from("memberships").insert({ org_id: existing.id, user_id: userId, role: "member" }),
          "join existing org by domain"
        );
        return { userId, orgId: existing.id as string };
      }
      console.warn(`[auth] domain auto-join to org ${existing.id} skipped — seat limit reached (${seats.used}/${seats.limit}). Creating a new org instead.`);
    }
  }

  // No org for this domain yet, or the one that exists is full → create one
  // with this user as owner.
  const slug = `${base}-${crypto.randomBytes(2).toString("hex")}`;
  const orgName = (email.split("@")[1] || "My org").replace(/\.(com|io|ai|dev|co|net|org).*$/, "");
  const trialEnds = new Date(Date.now() + 14 * 86400_000).toISOString(); // 14-day trial
  let org;
  ({ data: org } = await sb.from("orgs").insert({ name: orgName, slug, trial_ends_at: trialEnds }).select("id").single());
  if (!org) {
    // trial column may not exist yet (migration lag) — create without it.
    ({ data: org } = await sb.from("orgs").insert({ name: orgName, slug }).select("id").single());
  }
  const orgId = org.id as string;
  await mustWrite(
    sb.from("memberships").insert({ org_id: orgId, user_id: userId, role: "owner" }),
    "create owner membership"
  );
  return { userId, orgId };
}

/**
 * The session for a page that cannot render without one.
 *
 * app/layout.tsx redirects unauthenticated visitors, but a page and its layout
 * render CONCURRENTLY in the App Router — so `session!.orgId` in a page body
 * dereferences null before that redirect lands. The visitor still gets
 * redirected, which is why this stayed invisible; what it actually does is
 * throw a TypeError on every unauthenticated request, so a bot crawling /app
 * fills the error log with a fault that is not one.
 *
 * Found by the error tracker, on a page shipped an hour earlier.
 *
 * Returning a non-null session also removes the `!` assertions, which were the
 * thing quietly asserting this could not happen.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/* ── magic links ──────────────────────────────────────────────────────────── */

/** Create a single-use login token and return the absolute link to email.
 *
 *  The URL carries an opaque `link_id` (not the authentication secret).
 *  The real secret (`token_hash`) stays in the DB and is never in the URL,
 *  preventing Referer/log leakage of a directly-usable credential.
 */
export async function issueMagicLink(
  email: string,
  opts?: { orgInvite?: string; role?: Role; baseUrl?: string }
): Promise<string> {
  const sb = db();
  const raw = crypto.randomBytes(32).toString("hex");   // auth secret, never in URL
  const linkId = crypto.randomBytes(16).toString("hex"); // opaque URL reference
  const expires = new Date(Date.now() + MAGIC_MINUTES * 60_000).toISOString();
  // MUST throw on failure. This insert silently failed for every request while
  // auth_tokens.link_id was missing: the route still answered {ok:true}, the
  // email still went out, and the link was dead on arrival. A 500 here is
  // vastly better than mailing a credential that can never work.
  await mustWrite(
    sb.from("auth_tokens").insert({
      token_hash: sha256(raw),
      link_id: linkId,
      email: email.trim().toLowerCase(),
      org_invite: opts?.orgInvite ?? null,
      invite_role: opts?.role ?? null,
      expires_at: expires,
    }),
    "issue magic link"
  );
  // Land on a confirm PAGE (GET-safe against email link prefetchers / scanners);
  // the token is only consumed when the user clicks the button (a POST).
  const base = opts?.baseUrl || process.env.NEXT_PUBLIC_APP_URL || "https://runback.dev";
  return `${base}/auth/confirm?token=${linkId}`;
}

/** Consume a magic link: look up by opaque link_id, validate, ensure user+org, start session. */
export async function consumeMagicLink(
  linkIdOrRaw: string
): Promise<{ userId: string; orgId: string; seatLimitReached?: boolean } | null> {
  const sb = db();
  // Primary path: look up by link_id (new tokens post-migration).
  // Fallback: look up by token_hash for tokens issued before the link_id column existed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tok: any = null;
  const byLinkId = await sb
    .from("auth_tokens")
    .update({ used: true })
    .eq("link_id", linkIdOrRaw)
    .eq("used", false)
    .gt("expires_at", new Date().toISOString())
    .select()
    .maybeSingle();
  if (byLinkId.data) {
    tok = byLinkId.data;
  } else {
    // Legacy path: the value in the URL was the raw token itself (pre-link_id migration).
    const byHash = await sb
      .from("auth_tokens")
      .update({ used: true })
      .eq("token_hash", sha256(linkIdOrRaw))
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .select()
      .maybeSingle();
    tok = byHash.data ?? null;
  }
  if (!tok) return null;

  const email = tok.email as string;
  if (tok.org_invite) {
    // invite flow: ensure user exists, attach to the inviting org with the role.
    // Never downgrade an existing membership — only add new or upgrade to a higher role.
    // Capture their OWN org too (ensureUserAndOrg always resolves or creates
    // one) — if the invited org turns out to be full, that's what we return
    // instead, so the caller never creates a session for an org whose
    // memberships row was refused. inviteMember() already pre-checks this at
    // send time, but seats can fill in the days between an invite being sent
    // and clicked, so this is the check that actually has to hold.
    const { userId, orgId: ownOrgId } = await ensureUserAndOrg(email);
    const inviteRole: Role = (tok.invite_role as Role) || "member";
    const { data: existing } = await sb
      .from("memberships")
      .select("role")
      .eq("org_id", tok.org_invite)
      .eq("user_id", userId)
      .maybeSingle();
    if (!existing) {
      const seats = await seatStatus(tok.org_invite);
      if (!seats.available) {
        console.warn(`[auth] invite acceptance for org ${tok.org_invite} refused — seat limit reached (${seats.used}/${seats.limit}).`);
        return { userId, orgId: ownOrgId, seatLimitReached: true };
      }
      await sb.from("memberships").insert({ org_id: tok.org_invite, user_id: userId, role: inviteRole });
    } else if (ROLE_RANK[inviteRole] > ROLE_RANK[existing.role as Role]) {
      await sb.from("memberships").update({ role: inviteRole }).eq("org_id", tok.org_invite).eq("user_id", userId);
    }
    return { userId, orgId: tok.org_invite };
  }
  return ensureUserAndOrg(email);
}

/* ── sessions ─────────────────────────────────────────────────────────────── */

/**
 * Invalidate all active sessions for a user. Soft-revoke (not delete) so
 * "who force-signed-out this user, when, and why" stays answerable — see
 * sql/add_session_revocation.sql. Rows still age out via expires_at.
 */
export async function revokeUserSessions(userId: string, reason = "reauth", revokedBy: string | null = null): Promise<void> {
  await db().from("sessions")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokedBy, revoked_reason: reason })
    .eq("user_id", userId)
    .is("revoked_at", null);
}

export async function createSession(userId: string, orgId: string): Promise<void> {
  const sb = db();
  const raw = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  // Insert BEFORE setting the cookie, and fail hard: a cookie with no matching
  // session row is an invisible logged-out state that looks like a login.
  await mustWrite(
    sb.from("sessions").insert({
      token_hash: sha256(raw),
      user_id: userId,
      current_org_id: orgId,
      expires_at: expires.toISOString(),
    }),
    "create session"
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) {
    await db().from("sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: "self", revoked_reason: "logout" })
      .eq("token_hash", sha256(raw));
    jar.delete(SESSION_COOKIE);
  }
}

/** Read the current session → user + active org + role, or null. Memoized per request so layout + page share one DB roundtrip. */
export const getSession = cache(async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const sb = db();
  const { data: sess } = await sb
    .from("sessions")
    .select("user_id, current_org_id, expires_at, revoked_at")
    .eq("token_hash", sha256(raw))
    .maybeSingle();
  if (!sess || sess.revoked_at || new Date(sess.expires_at) < new Date()) return null;

  const { data: user } = await sb.from("users").select("email, name").eq("id", sess.user_id).maybeSingle();
  if (!user) return null;

  let orgId = sess.current_org_id as string | null;
  // fall back to any membership if the active org is unset
  let role: Role | null = null;
  if (orgId) {
    const { data: m } = await sb.from("memberships").select("role").eq("org_id", orgId).eq("user_id", sess.user_id).maybeSingle();
    role = (m?.role as Role) ?? null;
  }
  if (!role) {
    const { data: m } = await sb.from("memberships").select("org_id, role").eq("user_id", sess.user_id).limit(1);
    if (m && m.length) { orgId = m[0].org_id; role = m[0].role as Role; }
  }
  if (!orgId || !role) return null;

  // subscription_status/subscription_ends_at may not exist yet (migration lag —
  // see sql/add_subscription_status.sql) — fall back to the columns that have
  // always existed so a pending migration can never break session loading.
  let org: { name?: string; plan?: string; trial_ends_at?: string | null; subscription_status?: string | null; subscription_ends_at?: string | null } | null = null;
  {
    const { data, error } = await sb
      .from("orgs")
      .select("name, plan, trial_ends_at, subscription_status, subscription_ends_at")
      .eq("id", orgId)
      .maybeSingle();
    if (error) {
      ({ data: org } = await sb.from("orgs").select("name, plan, trial_ends_at").eq("id", orgId).maybeSingle());
    } else {
      org = data;
    }
  }
  const orgRef = { plan: org?.plan, trial_ends_at: org?.trial_ends_at };
  return {
    userId: sess.user_id,
    email: user.email,
    name: user.name ?? null,
    orgId,
    orgName: org?.name ?? "Org",
    orgPlan: featurePlan(orgRef),          // trial-aware effective plan for can()
    rawPlan: org?.plan ?? "free",
    trialEndsAt: org?.trial_ends_at ?? null,
    trialActive: trialActive(orgRef),
    subscriptionStatus: org?.subscription_status ?? null,
    subscriptionEndsAt: org?.subscription_ends_at ?? null,
    role,
  };
});

/** The orgs a user can switch between. */
export async function listUserOrgs(userId: string): Promise<{ orgId: string; name: string; role: Role }[]> {
  const sb = db();
  const { data } = await sb
    .from("memberships")
    .select("org_id, role, orgs(name)")
    .eq("user_id", userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data || []).map((m: any) => ({ orgId: m.org_id, name: m.orgs?.name ?? "Org", role: m.role }));
}
