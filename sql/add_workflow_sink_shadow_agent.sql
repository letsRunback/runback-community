-- Shadow-agent findings (an agent reporting runs but never declared in the
-- inventory) are rare and severe the same way ledger_tamper and critical_gap
-- are — not routine like a policy block — so this defaults to on, matching
-- those two rather than policy_block's opt-in-and-thresholded default.
ALTER TABLE ad_workflow_sinks ADD COLUMN IF NOT EXISTS on_shadow_agent boolean NOT NULL DEFAULT true;
