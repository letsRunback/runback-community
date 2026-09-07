-- alert_deliveries recorded a "fired" row unconditionally, even when the
-- actual send (email/Slack/webhook) failed — sendAlertEmail() returning
-- false, or a Resend/webhook error, was swallowed by deliver()'s catch
-- block and never reached the row. A customer had no way to know a
-- configured alert never actually sent, short of server logs they don't
-- have access to. delivered/error let evaluateRun() record the true outcome.
ALTER TABLE alert_deliveries ADD COLUMN IF NOT EXISTS delivered boolean NOT NULL DEFAULT true;
ALTER TABLE alert_deliveries ADD COLUMN IF NOT EXISTS error text;
