import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { resolvePrompt } from "@/lib/prompts/labels";

export const runtime = "nodejs";

/**
 * The primary deliverable: what an agent's backend/CI calls on every
 * invocation to fetch the prompt version currently live for a label —
 * `GET /api/prompts/:name?label=production`.
 *
 * Plain HTTP caching (Cache-Control + ETag), not a SaaS-only KV layer, so this
 * works identically behind Docker Compose with zero extra infra.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) return NextResponse.json({ error: "Sign in or pass an API key." }, { status: 401 });
  const { orgHasFeature } = await import("@/lib/planGate");
  if (!await orgHasFeature(caller.orgId, "quality")) {
    return NextResponse.json({ error: "Prompt management requires Growth plan or above." }, { status: 403 });
  }

  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const label = req.nextUrl.searchParams.get("label") ?? "production";

  const prompt = await resolvePrompt(caller.orgId, name, label);
  if (!prompt) {
    return NextResponse.json({ error: `No prompt "${name}" with label "${label}".` }, { status: 404 });
  }

  const body = {
    name: prompt.name,
    version: prompt.version,
    label,
    template: prompt.template,
    model: prompt.model,
    params: prompt.params,
    variables: prompt.variables,
  };
  const etag = `"${crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32)}"`;

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { etag, "cache-control": "max-age=60, stale-while-revalidate=300" } });
  }

  return NextResponse.json(body, {
    headers: { etag, "cache-control": "max-age=60, stale-while-revalidate=300" },
  });
}
