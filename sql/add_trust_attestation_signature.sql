-- Trust attestations moved from a bespoke, per-org-derived HMAC-only scheme
-- to the same signing primitive the per-run audit record uses: Ed25519
-- wherever this deployment has a keypair configured (AUDIT_ED25519_PRIVATE_KEY),
-- HMAC-SHA256 fallback otherwise — see web/lib/signing.ts and web/lib/trust.ts.
--
-- `token` keeps its name and stores the same thing it always did: the
-- signature's hex value. `signature_alg`/`signature_pubkey` are new so a
-- stored edge records which scheme sealed it and (for Ed25519) the embedded
-- public key needed to verify it.
--
-- This table is a fully derived cache — deriveAndPersistChain() re-computes
-- and re-persists every edge from the agent graph on read (see
-- lib/trust.ts), it is never the sole copy of anything a customer has
-- already exported and relied on. Rows written under the old per-org HMAC
-- scheme cannot be re-verified under the new algorithm (the derivation
-- itself changed, not just the wire format), so this clears the cache
-- rather than leaving mismatched rows to read back as a false "broken"
-- verdict. It repopulates itself the next time each run's trust chain page
-- loads.
ALTER TABLE trust_attestations ADD COLUMN IF NOT EXISTS signature_alg text NOT NULL DEFAULT 'HMAC-SHA256';
ALTER TABLE trust_attestations ADD COLUMN IF NOT EXISTS signature_pubkey text;

TRUNCATE trust_attestations;
