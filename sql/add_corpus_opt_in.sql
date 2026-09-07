-- Default false — GDPR Art.25 privacy-by-default.
-- Orgs must explicitly opt in; consent must not be assumed.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS corpus_opt_in BOOLEAN NOT NULL DEFAULT false;
