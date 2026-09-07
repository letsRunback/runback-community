import { NextRequest, NextResponse } from "next/server";
import { resolveScimKey } from "@/lib/apiKeys";
import { orgHasFeature } from "@/lib/planGate";
import { scimListUsers, scimCreateUser, scimError, SCIM_ERROR_SCHEMA } from "@/lib/scim";
import { getSsoConfig } from "@/lib/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SCIM responses carry their own content type; IdPs check it. */
const scimJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "content-type": "application/scim+json" } });

/**
 * Bearer token → org. The token is `scim`-scoped, so it can provision members
 * and nothing else: it cannot ingest runs, read run content, or open a session.
 */
async function authorize(req: NextRequest): Promise<{ orgId: string } | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const resolved = await resolveScimKey(token);
  if (!resolved) {
    return scimJson({ schemas: [SCIM_ERROR_SCHEMA], status: "401", detail: "Invalid or missing SCIM bearer token." }, 401);
  }
  // Provisioning rides on the SSO entitlement — the same buyer, and it makes no
  // sense to provision into a workspace that cannot federate sign-in.
  if (!(await orgHasFeature(resolved.orgId, "sso"))) {
    return scimJson({ schemas: [SCIM_ERROR_SCHEMA], status: "403", detail: "SCIM provisioning requires the Enterprise plan." }, 403);
  }
  return resolved;
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const filter = req.nextUrl.searchParams.get("filter");
    // startIndex/count were accepted and ignored, and itemsPerPage was
    // fabricated from whatever happened to be returned. An IdP paging a large
    // directory would loop over the same first page.
    const sp = req.nextUrl.searchParams;
    const num = (k: string) => {
      const v = Number(sp.get(k));
      return Number.isFinite(v) && v > 0 ? v : undefined;
    };
    return scimJson(
      await scimListUsers(auth.orgId, filter, { startIndex: num("startIndex"), count: num("count") })
    );
  } catch (e) {
    return scimJson(scimError(500, (e as Error).message), 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return scimJson(scimError(400, "Invalid JSON body."), 400);
  }
  try {
    const sso = await getSsoConfig(auth.orgId);
    const { user, created } = await scimCreateUser(auth.orgId, body, sso?.defaultRole ?? "member");
    // 201 on create, 200 when the IdP re-sends one we already have — a retry
    // must not look like a failure or the whole sync stalls.
    return scimJson(user, created ? 201 : 200);
  } catch (e) {
    return scimJson(scimError(400, (e as Error).message), 400);
  }
}
