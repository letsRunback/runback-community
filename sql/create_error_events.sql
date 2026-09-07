-- Production error tracking, grouped.
--
-- WHY NOT SENTRY
-- Sending errors to a third party would add a subprocessor to the DPA, put
-- customer identifiers and request context outside the deployment, and be
-- unavailable to self-hosters — who are the operators of their own instance and
-- need this most. For a product sold on evidence custody, "our error reports
-- leave your network" is a bad answer to a procurement question. Errors stay in
-- the same database as everything else and can be forwarded to the customer's
-- own SIEM through the sink that already exists.
--
-- GROUPED, NOT A FIRELIST
-- One row per distinct fault (fingerprint), with a count and first/last seen.
-- Ten thousand instances of the same broken query is one row that says 10,000 —
-- not ten thousand rows nobody reads. Ungrouped error logs are how outages hide
-- in plain sight.

CREATE TABLE IF NOT EXISTS ad_error_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable identity of the fault: route + error name + normalised message.
  fingerprint  text NOT NULL,

  -- Nullable: plenty of failures happen before a session is resolved, and an
  -- error that cannot be attributed still has to be recorded.
  org_id       uuid REFERENCES orgs(id) ON DELETE SET NULL,

  name         text NOT NULL,               -- error constructor, e.g. TypeError
  message      text NOT NULL,
  stack        text,
  route        text,                        -- pathname, never the query string
  method       text,
  severity     text NOT NULL DEFAULT 'error' CHECK (severity IN ('warning','error','fatal')),

  occurrences  integer NOT NULL DEFAULT 1,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),

  -- Set when someone has dealt with it. A new occurrence reopens the row, so a
  -- fault that returns is not silently absorbed into a resolved group.
  resolved_at  timestamptz,
  notified_at  timestamptz                  -- set once alerted, so one fault does not page repeatedly
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_error_events_fp ON ad_error_events(fingerprint);
CREATE INDEX IF NOT EXISTS ad_error_events_recent ON ad_error_events(last_seen DESC);
CREATE INDEX IF NOT EXISTS ad_error_events_open
  ON ad_error_events(last_seen DESC) WHERE resolved_at IS NULL;

ALTER TABLE ad_error_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ad_error_events' AND policyname = 'service_all') THEN
    CREATE POLICY "service_all" ON ad_error_events FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- Record an occurrence: insert the group, or bump it and reopen if it had been
-- resolved. Atomic so concurrent requests failing the same way cannot race into
-- duplicate groups or lose a count.
CREATE OR REPLACE FUNCTION record_error(
  p_fingerprint text, p_org uuid, p_name text, p_message text,
  p_stack text, p_route text, p_method text, p_severity text
)
RETURNS TABLE(is_new boolean, occurrences integer) AS $$
DECLARE v_new boolean; v_count integer;
BEGIN
  INSERT INTO ad_error_events (fingerprint, org_id, name, message, stack, route, method, severity)
  VALUES (p_fingerprint, p_org, p_name, p_message, p_stack, p_route, p_method, COALESCE(p_severity, 'error'))
  ON CONFLICT (fingerprint) DO UPDATE
    SET occurrences = ad_error_events.occurrences + 1,
        last_seen   = now(),
        -- Keep the newest context; an old stack is less useful than a current one.
        stack       = COALESCE(EXCLUDED.stack, ad_error_events.stack),
        org_id      = COALESCE(EXCLUDED.org_id, ad_error_events.org_id),
        -- A recurrence reopens the group and re-arms notification.
        resolved_at = NULL,
        notified_at = CASE WHEN ad_error_events.resolved_at IS NOT NULL THEN NULL ELSE ad_error_events.notified_at END
  RETURNING (ad_error_events.occurrences = 1), ad_error_events.occurrences
  INTO v_new, v_count;

  RETURN QUERY SELECT v_new, v_count;
END $$ LANGUAGE plpgsql;
