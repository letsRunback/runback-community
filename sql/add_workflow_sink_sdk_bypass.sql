-- sdk_bypass findings (an unwrapped provider call detected outside any
-- withDebugger()-instrumented context, see packages/sdk/src/bypassGuard.ts)
-- are rare and severe the same way ledger_tamper/critical_gap/shadow_agent
-- are, so this defaults to on, matching those rather than policy_block's
-- opt-in-and-thresholded default.
ALTER TABLE ad_workflow_sinks ADD COLUMN IF NOT EXISTS on_sdk_bypass boolean NOT NULL DEFAULT true;
