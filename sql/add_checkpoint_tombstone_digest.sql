-- Bind the tombstone set into the signed checkpoint.
--
-- A tombstone excuses a sealed run's content mismatch (the run was authorised-
-- deleted, so its leaf can no longer be re-derived). But tombstones were NOT
-- covered by the checkpoint signature, so anyone who could write to the database
-- could alter a sealed run AND insert a tombstone for it, and verification would
-- report the ledger intact — defeating exactly the operator-tamper threat that
-- checkpoint signing and external witnessing exist to catch.
--
-- The signed payload now includes a digest of the tombstone set. A tombstone
-- added after the last seal is not in the signed digest, so it cannot excuse a
-- mismatch until a new checkpoint anchors it (a re-seal, which needs the signing
-- key and a fresh external time-stamp that cannot be backdated). Legitimate
-- retention deletions are anchored the same way: delete, then seal.
--
-- Nullable: checkpoints sealed before this column verify against their original
-- (digest-free) payload, so existing signatures stay valid. Re-seal to upgrade
-- a checkpoint to tombstone coverage.
ALTER TABLE ad_ledger_checkpoints
  ADD COLUMN IF NOT EXISTS tombstone_digest text;
