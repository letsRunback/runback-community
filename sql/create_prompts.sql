-- Prompt registry: versioned, provider-agnostic prompt templates with
-- movable labels (production/staging/custom) pointing at a specific version.
-- Modeled on ad_policies (sql/create_policies.sql) — each save is an
-- immutable new version, never a mutation of an existing row.
CREATE TABLE IF NOT EXISTS ad_prompts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name           text NOT NULL,
  version        int  NOT NULL DEFAULT 1,
  template       jsonb NOT NULL,             -- [{role, content}], {{var}} placeholders
  model          jsonb NOT NULL,             -- {provider, model_id}
  params         jsonb NOT NULL DEFAULT '{}',
  variables      jsonb NOT NULL DEFAULT '[]', -- [{name, required, description?, default?}]
  commit_message text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name, version)
);
ALTER TABLE ad_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_prompts FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_prompts_org_name ON ad_prompts(org_id, name, version DESC);

-- A label ("production", "staging", or any custom name) points at exactly one
-- version of a named prompt. Moving "production" requires admin — enforced in
-- code (lib/prompts/labels.ts), not a stored "protected" column.
CREATE TABLE IF NOT EXISTS ad_prompt_labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  label      text NOT NULL,
  prompt_id  uuid NOT NULL REFERENCES ad_prompts(id) ON DELETE CASCADE,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name, label)
);
ALTER TABLE ad_prompt_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_prompt_labels FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_prompt_labels_lookup ON ad_prompt_labels(org_id, name, label);
