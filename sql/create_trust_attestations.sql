-- Moat 5: Inter-agent trust fabric
-- Every edge in the agent-to-agent delegation graph is sealed with a
-- signed attestation token. The chain is independently verifiable: any
-- break (tampered agent name, wrong depth, forged scope) fails the HMAC.

CREATE TABLE IF NOT EXISTS trust_attestations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  parent_run_id    text        NOT NULL,  -- calling agent's run
  child_run_id     text        NOT NULL,  -- called agent's run
  calling_agent    text        NOT NULL,
  called_agent     text        NOT NULL,
  delegation_depth int         NOT NULL DEFAULT 0,
  scope            text[]      NOT NULL DEFAULT '{*}',
  attestation_hash text        NOT NULL,  -- SHA-256 of canonical payload
  token            text        NOT NULL,  -- HMAC-SHA256(payload, org signing key)
  parent_token_hash text,                 -- hash of parent edge's token (chain link)
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trust_attestations_edge_idx
  ON trust_attestations (org_id, parent_run_id, child_run_id);

CREATE INDEX IF NOT EXISTS trust_attestations_child_idx
  ON trust_attestations (org_id, child_run_id);

CREATE INDEX IF NOT EXISTS trust_attestations_parent_idx
  ON trust_attestations (org_id, parent_run_id);
