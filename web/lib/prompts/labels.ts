/**
 * Prompt labels — a mutable pointer ("production", "staging", or any custom
 * name) at an immutable ad_prompts version. resolvePrompt is the runtime-fetch
 * hot path: one indexed join, no version resolution logic in the caller.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { atLeast, type Role } from "@/lib/auth";
import type { AuditActor } from "@/lib/adminAudit";
import type { PromptRow } from "./prompts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const PROMPT_COLS = "id,name,version,template,model,params,variables,commit_message,created_by,created_at";

export interface PromptLabelRow {
  label: string;
  version: number;
  prompt_id: string;
  updated_by: string | null;
  updated_at: string;
}

/** Resolve a named prompt's version by label. Returns null if either doesn't exist. */
export async function resolvePrompt(orgId: string, name: string, label: string): Promise<PromptRow | null> {
  const { data: labelRow } = await db()
    .from("ad_prompt_labels")
    .select("prompt_id")
    .eq("org_id", orgId)
    .eq("name", name)
    .eq("label", label)
    .maybeSingle();
  if (!labelRow?.prompt_id) return null;

  const { data } = await db().from("ad_prompts").select(PROMPT_COLS).eq("id", labelRow.prompt_id).maybeSingle();
  return (data as PromptRow | null) ?? null;
}

/** Every label currently set for a named prompt, with the version it points at. */
export async function listLabels(orgId: string, name: string): Promise<PromptLabelRow[]> {
  const { data } = await db()
    .from("ad_prompt_labels")
    .select("label,prompt_id,updated_by,updated_at,ad_prompts!inner(version)")
    .eq("org_id", orgId)
    .eq("name", name);
  return ((data ?? []) as { label: string; prompt_id: string; updated_by: string | null; updated_at: string; ad_prompts: { version: number } }[]).map(
    (r) => ({ label: r.label, version: r.ad_prompts.version, prompt_id: r.prompt_id, updated_by: r.updated_by, updated_at: r.updated_at })
  );
}

/**
 * Point a label at a specific version. Moving "production" requires admin —
 * enforced here, beneath the route, so no future caller can skip the check.
 */
export async function setLabel(
  orgId: string,
  callerRole: Role,
  name: string,
  label: string,
  version: number,
  actor?: AuditActor
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (label === "production" && !atLeast(callerRole, "admin")) {
    return { ok: false, error: "You need admin access to move the production label." };
  }

  const { data: prompt } = await db().from("ad_prompts").select("id").eq("org_id", orgId).eq("name", name).eq("version", version).maybeSingle();
  if (!prompt?.id) return { ok: false, error: `No version ${version} of "${name}".` };

  await db().from("ad_prompt_labels").upsert(
    { org_id: orgId, name, label, prompt_id: prompt.id, updated_by: actor?.email ?? null, updated_at: new Date().toISOString() },
    { onConflict: "org_id,name,label" }
  );

  const { logAdminAction } = await import("@/lib/adminAudit");
  await logAdminAction({
    orgId,
    actor,
    action: "prompt.label_move",
    targetType: "prompt",
    targetId: prompt.id,
    metadata: { name, label, version },
  });

  return { ok: true };
}
