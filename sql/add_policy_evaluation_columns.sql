-- Migration 60: policy evaluation evidence columns.
-- Runtime policy enforcement (packages/sdk collector.enforceToolCall) always
-- fires before a guarded tool call, but until now only the BLOCK path left
-- evidence (ToolEvent.policy_block). The allow path was a silent no-op —
-- zero record that the engine ever ran and passed a call. Worse, every
-- downstream reader (compliance.ts, proof.ts, benchmark.ts, modelDiff.ts,
-- the policy-causes cron) was filtering on a field name (`policy_blocked`)
-- that the write side never actually set (it writes `policy_block`, an
-- object) — so all of that reporting has been silently empty in production.
--
-- These columns denormalize the new `policy_evaluated`/existing `policy_block`
-- fields (see packages/schema/src/events.ts ToolEvent) for cheap counting,
-- the same idiom as the existing model_id/tool_name columns.
ALTER TABLE ad_events ADD COLUMN IF NOT EXISTS policy_evaluated boolean;
ALTER TABLE ad_events ADD COLUMN IF NOT EXISTS policy_blocked   boolean;
