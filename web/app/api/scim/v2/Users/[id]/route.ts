import { NextRequest, NextResponse } from "next/server";
import { resolveScimKey } from "@/lib/apiKeys";
import { orgHasFeature } from "@/lib/planGate";
import { scimGetUser, scimSetActive, scimError, SCIM_ERROR_SCHEMA } from "@/lib/scim";
import { getSsoConfig } from "@/lib/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scimJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "content-type": "application/scim+json" } });

async function authorize(req: NextRequest): Promise<{ orgId: string } | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const resolved = await resolveScimKey(token);
  if (!resolved) {
    return scimJson({ schemas: [SCIM_ERROR_SCHEMA], status: "401", detail: "Invalid or missing SCIM bearer token." }, 401);
  }
  if (!(await orgHasFeature(resolved.orgId, "sso"))) {
    return scimJson({ schemas: [SCIM_ERROR_SCHEMA], status: "403", detail: "SCIM provisioning requires the Enterprise plan." }, 403);
  }
  return resolved;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  const user = await scimGetUser(auth.orgId, id).catch(() => null);
  if (!user) return scimJson(scimError(404, "User not found in this organisation."), 404);
  return scimJson(user);
}

/**
 * Deactivation. Okta and Entra both express offboarding as
 * PATCH { Operations: [{ op: "replace", value: { active: false } }] }, and
 * some send `path: "active"` with a scalar value instead — accept both, since
 * failing to parse a deprovision request means a leaver keeps their access.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  let body: { Operations?: { op?: string; path?: string; value?: unknown }[] };
  try {
    body = await req.json();
  } catch {
    return scimJson(scimError(400, "Invalid JSON body."), 400);
  }

  let active: boolean | null = null;
  for (const op of body.Operations ?? []) {
    if ((op.op ?? "").toLowerCase() !== "replace" && (op.op ?? "").toLowerCase() !== "add") continue;
    if (op.path === "active") {
      active = op.value === true || op.value === "True" || op.value === "true";
    } else if (op.value && typeof op.value === "object" && "active" in (op.value as Record<string, unknown>)) {
      const v = (op.value as Record<string, unknown>).active;
      active = v === true || v === "True" || v === "true";
    }
  }
  if (active === null) {
    return scimJson(scimError(400, "Only the `active` attribute can be patched."), 400);
  }

  try {
    const sso = await getSsoConfig(auth.orgId);
    const ok = await scimSetActive(auth.orgId, id, active, sso?.defaultRole ?? "member");
    if (!ok) return scimJson(scimError(404, "User not found."), 404);
    const user = await scimGetUser(auth.orgId, id);
    // After deactivation the membership is gone, so there is no user to return
    // in this org — report the state the IdP asked for rather than a 404.
    return scimJson(user ?? { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], id, active: false });
  } catch (e) {
    return scimJson(scimError(409, (e as Error).message), 409);
  }
}

/**
 * Full replace.
 *
 * Okta's "Push Profile Updates" sends PUT, not PATCH, and this route answered
 * 405 — so enabling that (default) option made every sync fail, including the
 * deactivations that ride along with it. RFC 7644 §3.5.1 treats PUT as a
 * complete replacement of the resource.
 *
 * Only `active` is actually actionable here: a Runback membership carries no
 * profile fields of its own, and email is the identity rather than an editable
 * attribute. So the other attributes are accepted and ignored, which is the
 * honest behaviour for a replace against a resource with nothing else to
 * replace — and the Schemas endpoint advertises exactly that surface, so an IdP
 * is not misled into mapping fields we drop.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  let body: { active?: unknown };
  try {
    body = await req.json();
  } catch {
    return scimJson(scimError(400, "Invalid JSON body."), 400);
  }

  // Entra sends the string "False"; Okta sends a real boolean. Absent means
  // active, matching SCIM's default for the attribute.
  const raw = body.active;
  const active =
    raw === undefined ? true : raw === true || raw === "True" || raw === "true";

  try {
    const sso = await getSsoConfig(auth.orgId);
    const ok = await scimSetActive(auth.orgId, id, active, sso?.defaultRole ?? "member");
    if (!ok) return scimJson(scimError(404, "User not found."), 404);
    const user = await scimGetUser(auth.orgId, id);
    return scimJson(user ?? { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], id, active: false });
  } catch (e) {
    return scimJson(scimError(409, (e as Error).message), 409);
  }
}

/** Hard delete: some IdPs deprovision with DELETE rather than PATCH. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  try {
    const ok = await scimSetActive(auth.orgId, id, false);
    if (!ok) return scimJson(scimError(404, "User not found."), 404);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return scimJson(scimError(409, (e as Error).message), 409);
  }
}
