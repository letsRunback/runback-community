-- Migration 57: per-org, versioned release-gate thresholds.
-- Previously hardcoded in web/lib/upgradeGate.ts (0.95 pass / 0.80 warning) --
-- every org got the same bar with no way to tune it and no record of what
-- bar a past gate run was actually judged against. Defaults preserve exactly
-- today's behavior; changing them is now a real, auditable org setting.
ALTER TABLE orgs
  ADD COLUMN IF NOT EXISTS gate_pass_threshold numeric(4,3) NOT NULL DEFAULT 0.950,
  ADD COLUMN IF NOT EXISTS gate_warn_threshold numeric(4,3) NOT NULL DEFAULT 0.800;
