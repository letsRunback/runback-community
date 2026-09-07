/**
 * Prompt registry — versioned, org-scoped prompt templates. Each save is an
 * immutable new version; a "current" version is only ever addressed through a
 * label (see ./labels.ts). Modeled on lib/eval/policies.ts's savePolicy.
 * Schema: sql/create_prompts.sql.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import type { AuditActor } from "@/lib/adminAudit";
import { extractVariableNames, type PromptMessage, type PromptVariable } from "./render";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface PromptModel {
  provider: string;
  model_id: string;
}

export interface PromptRow {
  id: string;
  name: string;
  version: number;
  template: PromptMessage[];
  model: PromptModel;
  params: Record<string, unknown>;
  variables: PromptVariable[];
  commit_message: string | null;
  created_by: string | null;
  created_at: string;
}

const COLS = "id,name,version,template,model,params,variables,commit_message,created_by,created_at";

/** Latest version of every prompt in the org. */
export async function listPrompts(orgId: string): Promise<PromptRow[]> {
  const { data } = await db()
    .from("ad_prompts")
    .select(COLS)
    .eq("org_id", orgId)
    .order("version", { ascending: false });
  const seen = new Set<string>();
  const out: PromptRow[] = [];
  for (const r of (data ?? []) as PromptRow[]) {
    if (seen.has(r.name)) continue; // first per name = highest version
    seen.add(r.name);
    out.push(r);
  }
  return out;
}

/** Every version of one named prompt, newest first. */
export async function listVersions(orgId: string, name: string): Promise<PromptRow[]> {
  const { data } = await db()
    .from("ad_prompts")
    .select(COLS)
    .eq("org_id", orgId)
    .eq("name", name)
    .order("version", { ascending: false });
  return (data ?? []) as PromptRow[];
}

export async function getPromptVersion(orgId: string, name: string, version: number): Promise<PromptRow | null> {
  const { data } = await db()
    .from("ad_prompts")
    .select(COLS)
    .eq("org_id", orgId)
    .eq("name", name)
    .eq("version", version)
    .maybeSingle();
  return (data as PromptRow | null) ?? null;
}

/** Save a prompt as a new immutable version. "latest" is moved to it automatically. */
export async function savePromptVersion(
  orgId: string,
  name: string,
  input: {
    template: PromptMessage[];
    model: PromptModel;
    params?: Record<string, unknown>;
    variables?: PromptVariable[];
    commit_message?: string | null;
  },
  actor?: AuditActor
): Promise<PromptRow> {
  if (!name.trim()) throw new Error("Prompt name is required.");
  if (!input.template.length) throw new Error("Prompt template needs at least one message.");
  if (!input.model?.provider || !input.model?.model_id) throw new Error("Prompt model is required.");

  const { data: cur } = await db()
    .from("ad_prompts")
    .select("version")
    .eq("org_id", orgId)
    .eq("name", name)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (cur?.version ?? 0) + 1;

  // A caller can pass explicit variable metadata (descriptions, defaults); if
  // it doesn't, every {{var}} referenced in the template is a required
  // variable by default — the template is already the source of truth for
  // which names exist, so there is nothing to hand-maintain in the common case.
  const variables = input.variables ?? extractVariableNames(input.template).map((varName) => ({ name: varName, required: true }));

  const { data, error } = await db()
    .from("ad_prompts")
    .insert({
      org_id: orgId,
      name,
      version,
      template: input.template,
      model: input.model,
      params: input.params ?? {},
      variables,
      commit_message: input.commit_message ?? null,
      created_by: actor?.email ?? null,
    })
    .select(COLS)
    .single();
  if (error) {
    console.error("savePromptVersion: insert failed", error.message);
    throw new Error("Could not save the prompt — try again.");
  }

  const row = data as PromptRow;

  await db().from("ad_prompt_labels").upsert(
    { org_id: orgId, name, label: "latest", prompt_id: row.id, updated_by: actor?.email ?? null, updated_at: new Date().toISOString() },
    { onConflict: "org_id,name,label" }
  );

  const { logAdminAction } = await import("@/lib/adminAudit");
  await logAdminAction({
    orgId,
    actor,
    action: version === 1 ? "prompt.create" : "prompt.update",
    targetType: "prompt",
    targetId: row.id,
    metadata: { name, version },
  });

  return row;
}
