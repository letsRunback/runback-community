-- Marketing signals: feed-sourced events that trigger social posts
CREATE TABLE IF NOT EXISTS marketing_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  type         text NOT NULL CHECK (type IN ('regulatory', 'model_release', 'incident', 'fleet_weekly')),
  source       text,
  title        text NOT NULL,
  summary      text,
  url          text UNIQUE,
  metadata     jsonb NOT NULL DEFAULT '{}',
  processed    boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  buffer_post_ids jsonb NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS marketing_signals_processed_idx ON marketing_signals (processed, created_at DESC);
CREATE INDEX IF NOT EXISTS marketing_signals_type_idx ON marketing_signals (type, created_at DESC);

-- Add segment column to newsletter_subscribers for targeted campaigns
ALTER TABLE newsletter_subscribers
  ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'general';

COMMENT ON COLUMN newsletter_subscribers.segment IS
  'developer | compliance | executive | general — set by which page the subscriber opted in from';
