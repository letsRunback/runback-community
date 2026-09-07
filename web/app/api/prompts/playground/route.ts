import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { isDemoRequest } from "@/lib/demoMode";
import { testPromptVariants } from "@/lib/prompts/playground";
import type { PromptMessage, PromptVariable } from "@/lib/prompts/render";

export const runtime = "nodejs";
export const maxDuration = 120;

interface PlaygroundBody {
  template?: PromptMessage[];
  variables?: PromptVariable[];
  values?: Record<string, string>;
  model?: { provider?: string; model_id?: string };
  params?: Record<string, unknown>;
  compare_model_ids?: string[];
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(`prompt-playground:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many test runs — give it a moment." }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) return NextResponse.json({ error: "Sign in or pass an API key." }, { status: 401 });
  // Live model call — viewers are read-only. The rate limit above is per IP,
  // so it caps burst rate but not who can spend the org's money.
  const { atLeast } = await import("@/lib/auth");
  if (!atLeast(caller.role, "member")) {
    return NextResponse.json({ error: "Viewers have read-only access." }, { status: 403 });
  }
  const { orgHasFeature } = await import("@/lib/planGate");
  if (!await orgHasFeature(caller.orgId, "quality")) {
    return NextResponse.json({ error: "Prompt management requires Growth plan or above." }, { status: 403 });
  }

  let body: PlaygroundBody;
  try {
    body = (await req.json()) as PlaygroundBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.template) || !body.template.length) {
    return NextResponse.json({ error: "template must be a non-empty array of {role, content}" }, { status: 400 });
  }
  if (body.variables !== undefined && !Array.isArray(body.variables)) {
    return NextResponse.json({ error: "variables must be an array" }, { status: 400 });
  }
  if (!body.model?.provider || !body.model?.model_id) {
    return NextResponse.json({ error: "model.provider and model.model_id are required" }, { status: 400 });
  }

  try {
    const results = await testPromptVariants(caller.orgId, {
      template: body.template,
      variables: body.variables ?? [],
      values: body.values ?? {},
      model: { provider: body.model.provider, model_id: body.model.model_id },
      params: body.params,
      compareModelIds: body.compare_model_ids,
      demo: await isDemoRequest(),
    });
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Test run failed." }, { status: 400 });
  }
}
