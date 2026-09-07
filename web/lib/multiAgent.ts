/**
 * Agent-to-agent trace stitching — queries parent_run_id to build the multi-agent
 * execution graph for a given run. BFS up to 3 levels, max 50 nodes. A run can be
 * an orchestrator (children != []) or a subagent (parent_run_id != null) or both.
 * Pro+ feature ("multiagent"). All queries org-scoped for tenant isolation.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { mustWrite } from "@/lib/supabase/write";

export interface AgentNode {
  run_id: string;
  name: string;
  status: string;
  step_count: number | null;
  total_tokens: number | null;
  started_at: string | null;
  ended_at: string | null;
  parent_run_id: string | null;
  depth: number;
  children: AgentNode[];
}

export interface AgentGraph {
  root: AgentNode;
  totalRuns: number;
  totalTokens: number;
  maxDepth: number;
}

/** Fetch the full agent graph rooted at runId (up to 3 levels deep, max 50 nodes). */
export async function getAgentGraph(runId: string, orgId: string): Promise<AgentGraph | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const { data: root } = await sb
    .from("ad_runs")
    .select("run_id,name,status,step_count,total_tokens,started_at,ended_at,parent_run_id,org_id")
    .eq("run_id", runId)
    .maybeSingle();

  if (!root || root.org_id !== orgId) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeMap = new Map<string, any>();
  nodeMap.set(root.run_id, root);
  let frontier = [root.run_id];

  for (let depth = 0; depth < 3 && frontier.length > 0 && nodeMap.size < 50; depth++) {
    const { data: children } = await sb
      .from("ad_runs")
      .select("run_id,name,status,step_count,total_tokens,started_at,ended_at,parent_run_id")
      .in("parent_run_id", frontier)
      .eq("org_id", orgId)
      .limit(50 - nodeMap.size);
    frontier = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const c of (children ?? []) as any[]) {
      if (!nodeMap.has(c.run_id)) { nodeMap.set(c.run_id, c); frontier.push(c.run_id); }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function buildNode(r: any, d: number): AgentNode {
    const children: AgentNode[] = [...nodeMap.values()]
      .filter((c) => c.parent_run_id === r.run_id)
      .map((c) => buildNode(c, d + 1));
    children.sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""));
    return { run_id: r.run_id, name: r.name ?? "agent", status: r.status ?? "running", step_count: r.step_count ?? null, total_tokens: r.total_tokens ?? null, started_at: r.started_at ?? null, ended_at: r.ended_at ?? null, parent_run_id: r.parent_run_id ?? null, depth: d, children };
  }

  const graph = buildNode(root, 0);
  let totalRuns = 0, totalTokens = 0, maxDepth = 0;
  function count(n: AgentNode, d: number) {
    totalRuns++; totalTokens += n.total_tokens ?? 0; if (d > maxDepth) maxDepth = d;
    n.children.forEach((c) => count(c, d + 1));
  }
  count(graph, 0);

  return { root: graph, totalRuns, totalTokens, maxDepth };
}

/**
 * Set parent_run_id for a run. Called from ingest when RunEvent start carries
 * metadata.parent_run_id. Tenant guard: parent must belong to same org.
 */
export async function setParentRunId(runId: string, parentRunId: string | null, orgId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  if (parentRunId) {
    const { data: parent } = await sb.from("ad_runs").select("org_id").eq("run_id", parentRunId).maybeSingle();
    if (!parent || parent.org_id !== orgId) return;
  }
  await mustWrite(
    sb.from("ad_runs").update({ parent_run_id: parentRunId }).eq("run_id", runId).eq("org_id", orgId),
    "stitch child run to parent"
  );
}
