import { NextRequest, NextResponse } from "next/server";
import { orgHasFeature } from "@/lib/planGate";
import { listPrompts, savePromptVersion } from "@/lib/prompts/prompts";
import type { PromptMessage, PromptVariable } from "@/lib/prompts/render";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) return NextResponse.json({ error: "Sign in or pass an API key." }, { status: 401 });
  if (!await orgHasFeature(caller.orgId, "quality")) {
    return NextResponse.json({ error: "Prompt management requires Growth plan or above." }, { status: 403 });
  }
  const prompts = await listPrompts(caller.orgId);
  return NextResponse.json({ prompts });
}

interface SavePromptBody {
  name?: string;
  template?: PromptMessage[];
  model?: { provider?: string; model_id?: string };
  params?: Record<string, unknown>;
  variables?: PromptVariable[];
  commit_message?: string | null;
}

export async function POST(req: NextRequest) {
  const { getCaller } = await import("@/lib/apiAuth");
  const caller = await getCaller(req);
  if (!caller?.orgId) return NextResponse.json({ error: "Sign in or pass an API key." }, { status: 401 });
  // Creates a prompt version. Only the `production` label was role-gated (see
  // lib/prompts/labels.ts), so a viewer could still write new versions.
  const { atLeast } = await import("@/lib/auth");
  if (!atLeast(caller.role, "member")) {
    return NextResponse.json({ error: "Viewers have read-only access." }, { status: 403 });
  }
  if (!await orgHasFeature(caller.orgId, "quality")) {
    return NextResponse.json({ error: "Prompt management requires Growth plan or above." }, { status: 403 });
  }

  let body: SavePromptBody;
  try {
    body = (await req.json()) as SavePromptBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!Array.isArray(body.template) || !body.template.length) {
    return NextResponse.json({ error: "template must be a non-empty array of {role, content}" }, { status: 400 });
  }
  if (!body.model?.provider || !body.model?.model_id) {
    return NextResponse.json({ error: "model.provider and model.model_id are required" }, { status: 400 });
  }

  try {
    const row = await savePromptVersion(
      caller.orgId,
      body.name.trim(),
      {
        template: body.template,
        model: { provider: body.model.provider, model_id: body.model.model_id },
        params: body.params,
        variables: body.variables,
        commit_message: body.commit_message,
      },
      { kind: caller.via === "api_key" ? "api_key" : "user", userId: caller.userId, email: caller.email }
    );
    return NextResponse.json({ ok: true, prompt: row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Save failed." }, { status: 400 });
  }
}
