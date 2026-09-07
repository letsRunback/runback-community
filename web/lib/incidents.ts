import { getAdminClient } from "@/lib/supabase/admin";

export type IncidentStatus = "open" | "investigating" | "remediated" | "closed";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";

// The API routes take these over untyped JSON, so `IncidentStatus`/
// `IncidentSeverity` are compile-time-only guarantees — a direct API call can
// send any string. An unrecognized status used to be accepted and stored
// as-is: IncidentActions's button row only renders a "Start investigating" /
// "Mark remediated" / "Close incident" button for the four known statuses
// (see IncidentActions.tsx), so an incident saved with e.g. status: "foo"
// rendered with NO action buttons at all — a dead-end exactly like the prior
// one-way status-transition trap this codebase already had. Validate against
// the real enum before it's ever written.
export const VALID_STATUSES: IncidentStatus[] = ["open", "investigating", "remediated", "closed"];
export const VALID_SEVERITIES: IncidentSeverity[] = ["low", "medium", "high", "critical"];

/**
 * Legal status transitions — matches exactly what IncidentActions.tsx offers
 * (open → investigating → remediated → closed, with investigating able to
 * close directly). Enum membership alone used to be the only check: any of
 * the 4 valid statuses was accepted from ANY current status, so a direct API
 * call could jump closed → open, or open → closed skipping the
 * investigation/remediation record entirely. `closed` is terminal — nothing
 * in the UI ever reopens an incident, so neither does this.
 */
export const VALID_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ["investigating"],
  investigating: ["remediated", "closed"],
  remediated: ["closed"],
  closed: [],
};

export interface TimelineEntry {
  at: string;
  actor: string;
  event: string;
  note?: string;
}

export interface IncidentRow {
  id: string;
  org_id: string;
  run_id: string;
  run_name?: string | null;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  root_cause?: string | null;
  remediation?: string | null;
  golden_run_id?: string | null;
  timeline: TimelineEntry[];
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export async function createIncident(row: {
  org_id: string;
  run_id: string;
  run_name?: string | null;
  title: string;
  severity: IncidentSeverity;
  root_cause?: string | null;
  created_by: string;
  initial_note?: string;
}): Promise<IncidentRow | null> {
  const firstEntry: TimelineEntry = {
    at: new Date().toISOString(),
    actor: row.created_by,
    event: "incident_opened",
    note: row.initial_note,
  };

  const { data } = await db()
    .from("incidents")
    .insert({
      org_id:     row.org_id,
      run_id:     row.run_id,
      run_name:   row.run_name ?? null,
      title:      row.title,
      severity:   row.severity,
      root_cause: row.root_cause ?? null,
      created_by: row.created_by,
      timeline:   [firstEntry],
    })
    .select()
    .single();
  return data ?? null;
}

export async function getIncident(id: string, orgId: string): Promise<IncidentRow | null> {
  const { data } = await db()
    .from("incidents")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  return data ?? null;
}

export async function listIncidents(
  orgId: string,
  status?: IncidentStatus
): Promise<IncidentRow[]> {
  let q = db()
    .from("incidents")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return data ?? [];
}

export type UpdateIncidentResult =
  | { ok: true; incident: IncidentRow }
  | { ok: false; code: "not_found" | "illegal_transition"; error: string };

export async function updateIncident(
  id: string,
  orgId: string,
  patch: {
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    root_cause?: string;
    remediation?: string;
    golden_run_id?: string;
  },
  actor: string,
  note?: string
): Promise<UpdateIncidentResult> {
  const current = await getIncident(id, orgId);
  if (!current) return { ok: false, code: "not_found", error: "Incident not found." };

  if (patch.status !== undefined && patch.status !== current.status) {
    const allowed = VALID_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(patch.status)) {
      return {
        ok: false,
        code: "illegal_transition",
        error: `Cannot move from "${current.status}" to "${patch.status}". Valid next step(s): ${allowed.length ? allowed.join(", ") : "none — this incident is closed"}.`,
      };
    }
  }

  const entry: TimelineEntry = {
    at: new Date().toISOString(),
    actor,
    event: patch.status ? `status_changed_to_${patch.status}` : "updated",
    note,
  };
  const timeline = [...current.timeline, entry];

  const update: Record<string, unknown> = {
    ...patch,
    timeline,
    updated_at: new Date().toISOString(),
  };
  if (patch.status === "closed") update.closed_at = new Date().toISOString();

  const { data } = await db()
    .from("incidents")
    .update(update)
    .eq("id", id)
    .eq("org_id", orgId)
    .select()
    .single();
  if (!data) return { ok: false, code: "not_found", error: "Incident not found." };
  return { ok: true, incident: data };
}

export async function openCount(orgId: string): Promise<number> {
  const { count } = await db()
    .from("incidents")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .in("status", ["open", "investigating"]);
  return count ?? 0;
}
