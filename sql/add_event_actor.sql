-- Migration 62: per-event actor.
-- TraceEvent gained an optional `actor` field (packages/schema/src/events.ts)
-- so a run can record WHO or WHAT triggered each step — a specific end-user,
-- an API-key/service identity, or an automated schedule — not just what
-- happened. Denormalized here for cheap filtering, same idiom as
-- model_id/tool_name; the full actor object (including an optional label)
-- still lives in ad_events.data for anything beyond type+id.
ALTER TABLE ad_events ADD COLUMN IF NOT EXISTS actor_type text;
ALTER TABLE ad_events ADD COLUMN IF NOT EXISTS actor_id   text;

-- Also denormalize onto ad_runs from the run-start event, so "which runs did
-- user X trigger" doesn't need a join through ad_events.
ALTER TABLE ad_runs ADD COLUMN IF NOT EXISTS actor_type text;
ALTER TABLE ad_runs ADD COLUMN IF NOT EXISTS actor_id   text;
