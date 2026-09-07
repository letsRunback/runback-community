/**
 * SCIM 2.0 discovery — RFC 7644 §4. Which resource types this provider serves.
 *
 * Users only. Groups are not implemented, and this endpoint is the place an IdP
 * finds that out cleanly rather than by receiving a 404 mid-provisioning.
 */
import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/deployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scimJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "content-type": "application/scim+json" } });

export async function GET() {
  const userResourceType = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    id: "User",
    name: "User",
    endpoint: "/Users",
    description: "A member of a Runback workspace.",
    schema: "urn:ietf:params:scim:schemas:core:2.0:User",
    schemaExtensions: [],
    meta: {
      resourceType: "ResourceType",
      location: `${siteUrl()}/api/scim/v2/ResourceTypes/User`,
    },
  };
  return scimJson({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [userResourceType],
  });
}
