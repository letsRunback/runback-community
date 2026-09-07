-- GDPR Art.25 privacy-by-default: change corpus_opt_in column default from true to false.
-- Existing orgs keep their current value — operators should communicate the change
-- and invite orgs to re-opt-in explicitly via Settings → Data & Privacy.
ALTER TABLE orgs ALTER COLUMN corpus_opt_in SET DEFAULT false;
