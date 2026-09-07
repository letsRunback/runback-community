/**
 * SCIM 2.0 discovery — RFC 7644 §4. The attribute schema we actually honour.
 *
 * Deliberately minimal: userName, name, active and emails are the attributes a
 * Runback membership has. Advertising the full core User schema would invite an
 * IdP to map fields we silently discard, which looks like a provisioning
 * success and behaves like data loss.
 */
import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/deployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scimJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "content-type": "application/scim+json" } });

const attr = (
  name: string,
  type: string,
  opts: Partial<{ required: boolean; caseExact: boolean; uniqueness: string; multiValued: boolean; subAttributes: unknown[] }> = {}
) => ({
  name,
  type,
  multiValued: opts.multiValued ?? false,
  required: opts.required ?? false,
  caseExact: opts.caseExact ?? false,
  mutability: "readWrite",
  returned: "default",
  uniqueness: opts.uniqueness ?? "none",
  ...(opts.subAttributes ? { subAttributes: opts.subAttributes } : {}),
});

export async function GET() {
  const userSchema = {
    id: "urn:ietf:params:scim:schemas:core:2.0:User",
    name: "User",
    description: "A member of a Runback workspace.",
    attributes: [
      attr("userName", "string", { required: true, uniqueness: "server" }),
      attr("name", "complex", {
        subAttributes: [attr("givenName", "string"), attr("familyName", "string"), attr("formatted", "string")],
      }),
      attr("emails", "complex", {
        multiValued: true,
        subAttributes: [attr("value", "string"), attr("primary", "boolean"), attr("type", "string")],
      }),
      attr("active", "boolean"),
    ],
    meta: {
      resourceType: "Schema",
      location: `${siteUrl()}/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User`,
    },
  };
  return scimJson({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [userSchema],
  });
}
