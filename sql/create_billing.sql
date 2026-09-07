-- Self-serve billing. The org's `plan` is the source of truth for entitlements;
-- these generic reference columns link it to the billing provider's customer +
-- subscription. Named stripe_* for historical reasons — they currently hold Lemon
-- Squeezy ids, and would hold Stripe ids again if/when we switch back.
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
CREATE INDEX IF NOT EXISTS orgs_stripe_customer_idx ON orgs(stripe_customer_id);
