/** SCIM 2.0 Groups — not implemented. See ../route.ts. */
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
export const PATCH = notImplemented;
export const PUT = notImplemented;
export const DELETE = notImplemented;
