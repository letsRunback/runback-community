-- Leads captured at the open-core get-started gate. Work email required to
-- receive the self-host quickstart + repo access. RLS, service-role only.
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  domain text NOT NULL,
  company text,
  use_case text,
  source text NOT NULL DEFAULT 'get-started',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON leads FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS leads_email_idx ON leads(email);
CREATE INDEX IF NOT EXISTS leads_domain_idx ON leads(domain);
