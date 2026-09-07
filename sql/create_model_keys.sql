-- Bring-your-own model keys (managed cloud). A customer adds their OpenAI /
-- Anthropic / Groq key once, in Settings, and live replay + counterfactuals +
-- golden-suite candidate runs use it. Stored AES-256-GCM encrypted (MODEL_KEY_SECRET),
-- never returned to the browser — only the last 4 chars are shown. Self-host can
-- keep using env vars and skip this entirely.
CREATE TABLE IF NOT EXISTS ad_model_keys (
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  provider   text NOT NULL,           -- openai | anthropic | groq
  key_cipher text NOT NULL,           -- iv.tag.ciphertext (base64), AES-256-GCM
  key_last4  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, provider)
);

ALTER TABLE ad_model_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON ad_model_keys;
CREATE POLICY service_all ON ad_model_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
