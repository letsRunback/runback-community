/**
 * Live snapshot of the org's actual integration surface, for the get-started
 * ecosystem diagram — real agent names and a real Connected/Detected/Not
 * configured status per outbound sink, not a static illustration. Bounded,
 * best-effort reads; nothing here should ever throw into the page.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { getSink } from "@/lib/siem";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export type SinkStatus = "connected" | "detected" | "none";

export interface EcosystemAgent {
  name: string;
  count: number;
}

export interface EcosystemSink {
  label: string;
  status: SinkStatus;
  detail: string;
  href: string;
}

export interface EcosystemSnapshot {
  agents: EcosystemAgent[];
  agentCount: number;
  runs24h: number;
  sinks: EcosystemSink[];
}

/** Status for an alert channel: fired at least once → connected; rule exists but never fired → detected; no rule → none. */
async function alertChannelStatus(orgId: string, channel: "slack" | "webhook"): Promise<{ status: SinkStatus; detail: string }> {
  const { data: rules } = await db()
    .from("alert_rules")
    .select("id,enabled")
    .eq("org_id", orgId)
    .eq("channel", channel);
  const rows = (rules ?? []) as { id: string; enabled: boolean }[];
  if (rows.length === 0) return { status: "none", detail: "No alert rule configured" };

  const ruleIds = rows.map((r) => r.id);
  const { data: deliveries } = await db()
    .from("alert_deliveries")
    .select("id")
    .in("rule_id", ruleIds)
    .limit(1);
  if (deliveries && deliveries.length > 0) {
    return { status: "connected", detail: `${rows.length} rule${rows.length === 1 ? "" : "s"} · has fired` };
  }
  const anyEnabled = rows.some((r) => r.enabled);
  return {
    status: "detected",
    detail: anyEnabled ? `${rows.length} rule${rows.length === 1 ? "" : "s"} · not fired yet` : "configured, disabled",
  };
}

async function siemStatus(orgId: string): Promise<{ status: SinkStatus; detail: string }> {
  const sink = await getSink(orgId).catch(() => null);
  if (!sink) return { status: "none", detail: "No SIEM export configured" };
  if (sink.enabled && sink.last_ok_at) {
    return { status: "connected", detail: `${sink.kind} · last export ${new Date(sink.last_ok_at).toLocaleDateString()}` };
  }
  if (sink.last_error) {
    return { status: "detected", detail: `${sink.kind} · last attempt failed` };
  }
  return { status: "detected", detail: `${sink.kind} · not exported yet` };
}

export async function getEcosystemSnapshot(orgId: string): Promise<EcosystemSnapshot> {
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();

  const [recentRes, runs24hRes, distinctRes, slack, webhook, siem] = await Promise.all([
    db().from("ad_runs").select("name").eq("org_id", orgId).order("created_at", { ascending: false }).limit(300),
    db().from("ad_runs").select("run_id", { count: "exact", head: true }).eq("org_id", orgId).gte("created_at", since24h),
    db().from("ad_runs").select("name").eq("org_id", orgId).limit(1000),
    alertChannelStatus(orgId, "slack"),
    alertChannelStatus(orgId, "webhook"),
    siemStatus(orgId),
  ]);

  const counts = new Map<string, number>();
  for (const r of (recentRes.data ?? []) as { name: string | null }[]) {
    const name = r.name || "unnamed-agent";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const agents = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const distinctNames = new Set(((distinctRes.data ?? []) as { name: string | null }[]).map((r) => r.name || "unnamed-agent"));

  return {
    agents,
    agentCount: distinctNames.size,
    runs24h: runs24hRes.count ?? 0,
    sinks: [
      { label: "Slack alerts", ...slack, href: "/app/alerts" },
      { label: "Webhook alerts", ...webhook, href: "/app/alerts" },
      { label: "SIEM export", ...siem, href: "/app/settings" },
    ],
  };
}
