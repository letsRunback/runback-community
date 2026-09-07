/**
 * SCIM 2.0 discovery — RFC 7644 §4.
 *
 * ServiceProviderConfig is mandatory, and Okta's generic SCIM connector probes
 * it during setup. It returned an HTML 404 — not even a SCIM error object — so
 * configuring Runback as a provisioning target failed before any user was
 * created, with an error message about unexpected content rather than a missing
 * endpoint.
 *
 * Everything advertised here is deliberately what we actually implement. An
 * over-generous config is worse than none: an IdP will happily use a capability
 * we claim and then break on the response.
 */
import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/deployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scimJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "content-type": "application/scim+json" } });

export async function GET() {
  const base = siteUrl();
  return scimJson({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: `${base}/docs#sso`,
    patch: { supported: true },
    // No bulk endpoint, and saying so is the point: an IdP that believes we
    // support bulk will batch its writes and every one of them will 404.
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 1000 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description:
          "A SCIM-scoped bearer token issued in Settings → Directory Provisioning. " +
          "It can create and deactivate members and nothing else — it cannot ingest " +
          "runs, read run content, or open a dashboard session.",
        specUri: "https://datatracker.ietf.org/doc/html/rfc6750",
        primary: true,
      },
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location: `${base}/api/scim/v2/ServiceProviderConfig`,
    },
  });
}
