-- Platform audit log: what people did to RUNBACK ITSELF.
--
-- ad_ledger records what the agents did. Nothing recorded what the operators
-- did — who changed a policy, revoked a key, exported evidence, released a
-- legal hold, or reconfigured SSO. For a governance product that is the first
-- gap a security reviewer finds, and the hardest to explain away.
--
-- Hash-chained with the same primitive as the run ledger (entry_hash =
-- sha256(prev_hash || leaf_hash)), so the operator log is tamper-evident on the
-- same terms we ask customers to trust for their agents. An admin who deletes
-- their own damning entry breaks the chain at that seq and cannot repair it
-- without the entries that follow.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ad_admin_events (
  org_id      uuid   NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  seq         bigint NOT NULL,             -- monotonic within the org
  event_id    uuid   NOT NULL,             -- caller-supplied; makes append idempotent on retry

  -- Who. actor_user_id may be null for API-key or system actors; actor_email is
  -- denormalised so the record still reads correctly after a user is deleted —
  -- an audit entry that becomes anonymous when someone offboards is worthless.
  actor_kind  text   NOT NULL CHECK (actor_kind IN ('user','api_key','system','scim')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,
  actor_label text,

  -- What. Dotted verbs: policy.create, api_key.revoke, sso.configure,
  -- member.role_change, evidence.export, legal_hold.release, retention.change.
  action      text   NOT NULL,
  target_type text,
  target_id   text,
  metadata    jsonb  NOT NULL DEFAULT '{}',

  -- Where from. Enterprises ask for this explicitly in security reviews.
  ip          text,
  user_agent  text,

  leaf_hash   text   NOT NULL,             -- sha256(canonical(event content))
  prev_hash   text   NOT NULL,             -- previous entry_hash ('' for the first)
  entry_hash  text   NOT NULL,             -- sha256(prev_hash || leaf_hash)
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, seq)
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_admin_events_event ON ad_admin_events(org_id, event_id);
CREATE INDEX IF NOT EXISTS ad_admin_events_recent ON ad_admin_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ad_admin_events_action ON ad_admin_events(org_id, action, created_at DESC);

ALTER TABLE ad_admin_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ad_admin_events' AND policyname = 'service_all') THEN
    CREATE POLICY "service_all" ON ad_admin_events FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- Atomic append: serializes per org, assigns the next seq, links the chain.
-- Idempotent on (org_id, event_id) so a retried write never forks the chain.
CREATE OR REPLACE FUNCTION admin_event_append(
  p_org uuid, p_event uuid, p_leaf text,
  p_actor_kind text, p_actor_user uuid, p_actor_email text, p_actor_label text,
  p_action text, p_target_type text, p_target_id text, p_metadata jsonb,
  p_ip text, p_user_agent text
)
RETURNS TABLE(seq bigint, prev_hash text, entry_hash text) AS $$
DECLARE
  v_seq bigint; v_prev text; v_entry text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('admin:' || p_org::text, 0));

  SELECT e.seq, e.prev_hash, e.entry_hash INTO v_seq, v_prev, v_entry
    FROM ad_admin_events e WHERE e.org_id = p_org AND e.event_id = p_event;
  IF FOUND THEN
    RETURN QUERY SELECT v_seq, v_prev, v_entry; RETURN;
  END IF;

  SELECT COALESCE(MAX(e.seq), -1) INTO v_seq FROM ad_admin_events e WHERE e.org_id = p_org;
  SELECT COALESCE(e.entry_hash, '') INTO v_prev
    FROM ad_admin_events e WHERE e.org_id = p_org ORDER BY e.seq DESC LIMIT 1;
  v_prev := COALESCE(v_prev, '');
  v_seq  := v_seq + 1;
  v_entry := encode(digest(v_prev || p_leaf, 'sha256'), 'hex');

  INSERT INTO ad_admin_events (
    org_id, seq, event_id, actor_kind, actor_user_id, actor_email, actor_label,
    action, target_type, target_id, metadata, ip, user_agent,
    leaf_hash, prev_hash, entry_hash
  ) VALUES (
    p_org, v_seq, p_event, p_actor_kind, p_actor_user, p_actor_email, p_actor_label,
    p_action, p_target_type, p_target_id, COALESCE(p_metadata, '{}'::jsonb), p_ip, p_user_agent,
    p_leaf, v_prev, v_entry
  );

  RETURN QUERY SELECT v_seq, v_prev, v_entry;
END $$ LANGUAGE plpgsql;
