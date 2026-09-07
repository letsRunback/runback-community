-- Session revocation was a hard DELETE with no audit trail — revokeUserSessions
-- and destroySession simply removed the row, so "who force-signed-out this
-- user, when, and why" was unanswerable after the fact. Additive columns let
-- getSession() reject a revoked-but-not-yet-expired row while keeping the
-- reason visible for as long as the row exists (sessions still age out via
-- expires_at; this doesn't add a second cleanup path).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_by text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_reason text;
