-- Migration 63: newsletter subscriber segment.
--
-- web/app/api/newsletter/subscribe/route.ts has always written a `segment`
-- ("developer" | "compliance" | "executive" | "general"), but no migration ever
-- declared the column. Production acquired it by hand, so scripts/check-schema.mjs
-- — which derives its expectations FROM sql/ — saw nothing wrong, while any
-- fresh database (every self-host, every new environment) returned HTTP 400 on
-- the upsert and answered every signup with "Failed to subscribe."
ALTER TABLE newsletter_subscribers
  ADD COLUMN IF NOT EXISTS segment text NOT NULL DEFAULT 'general';

-- The weekly send filters on unsubscribed and (once segmented) on segment.
CREATE INDEX IF NOT EXISTS newsletter_subscribers_segment_idx
  ON newsletter_subscribers(segment) WHERE unsubscribed = false;

-- Per-subscriber send cursor.
--
-- The weekly cron selected the first 500 subscribers and looped, one blocking
-- Resend call plus a 60ms sleep each, under maxDuration=60. That cannot finish a
-- real list: it times out partway through, always on the same prefix, so anyone
-- past the cutoff never receives anything and nothing reports a problem. There
-- was also no idempotency — a retry re-sent to everyone already delivered.
--
-- Recording which issue each subscriber last received turns the send into a
-- resumable, idempotent queue: each run picks up only those who have not yet
-- had this week's issue, and a re-run is a no-op.
ALTER TABLE newsletter_subscribers
  ADD COLUMN IF NOT EXISTS last_sent_week text;

CREATE INDEX IF NOT EXISTS newsletter_subscribers_pending_idx
  ON newsletter_subscribers(last_sent_week) WHERE unsubscribed = false;
