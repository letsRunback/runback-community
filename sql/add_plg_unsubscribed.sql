-- EU ePrivacy / UK PECR: users must be able to opt out of PLG marketing emails.
ALTER TABLE users ADD COLUMN IF NOT EXISTS plg_email_unsubscribed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS users_plg_unsub_idx ON users(plg_email_unsubscribed) WHERE plg_email_unsubscribed = true;
