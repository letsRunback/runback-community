/**
 * SCIM 2.0 Groups — not implemented (see ResourceTypes, which advertises this
 * honestly so a spec-compliant IdP never calls here). Something that ignores
 * that discovery and calls /Groups directly anyway still deserves a
 * SCIM-shaped 404, not Next's generic HTML not-found page — an IdP client
 * library expects `application/scim+json` on every response under /scim/v2.
 */
import { NextResponse } from "next/server";
import { scimError } from "@/lib/scim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scimJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "content-type": "application/scim+json" } });

function notImplemented() {
  return scimJson(scimError(404, "Groups are not supported — see /ResourceTypes."), 404);
}

export const GET = notImplemented;
export const POST = notImplemented;
export const PATCH = notImplemented;
export const PUT = notImplemented;
export const DELETE = notImplemented;
