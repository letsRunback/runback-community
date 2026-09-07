-- Persist each run's oracle-stream (cassette) digest at ingest, so whole-run
-- re-execution can verify the stored events still reproduce it — tamper-evident.
ALTER TABLE ad_runs ADD COLUMN IF NOT EXISTS cassette_digest text;

-- The per-step running chain hashes ([{seq,kind,hash}, …]) captured at ingest.
-- Lets a verifier pinpoint the EXACT oracle entry a tampered run first departs
-- from the attested chain, not just "something changed". Optional / best-effort.
ALTER TABLE ad_runs ADD COLUMN IF NOT EXISTS cassette_chain jsonb;
