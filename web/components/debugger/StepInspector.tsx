"use client";

import { useState } from "react";
import type {
  TraceEvent,
  LlmEvent,
  ToolEvent,
  RunEvent,
  ReasoningEvent,
  ModelMessage,
} from "@runback/schema";
import JsonView from "./JsonView";
import ReplayPanel from "./ReplayPanel";
import AddToDataset from "@/components/eval/AddToDataset";
import { stepCaption } from "@/lib/narrative";

/** Plain-English caption strip so the detail pane reads in human terms too. */
function InspectorTop({ event }: { event: TraceEvent }) {
  const caption = stepCaption(event);
  if (!caption) return null;
  const kindLabel =
    event.type === "llm"
      ? "Model step"
      : event.type === "tool"
        ? "Tool step"
        : event.type === "run"
          ? "Run"
          : "Note";
  return (
    <div className="insp-context">
      <span className="ic-kind">{kindLabel}</span>
      <span className="ic-cap">{caption}</span>
    </div>
  );
}

export default function StepInspector({
  event,
  onJumpToSpan,
  requesterSpanId,
  datasetBasePath = "/datasets",
}: {
  event: TraceEvent | null;
  /** Jump to another span (used by the causal tool↔LLM links). */
  onJumpToSpan: (spanId: string) => void;
  /** For a tool event: the span_id of the LLM call that requested it. */
  requesterSpanId: string | null;
  /** Where AddToDataset's post-creation "View dataset" link should land —
      /app/datasets inside the authenticated shell, /datasets on the public page. */
  datasetBasePath?: "/datasets" | "/app/datasets";
}) {
  if (!event) {
    return (
      <div className="insp">
        <div className="insp-body">
          <p className="empty">Select a step to inspect it.</p>
        </div>
      </div>
    );
  }

  // Remount on span change (key) so each inspector's initial tab is fresh —
  // no setState-in-effect needed.
  switch (event.type) {
    case "llm":
      return <LlmInspector key={event.span_id} event={event} datasetBasePath={datasetBasePath} />;
    case "tool":
      return (
        <ToolInspector
          key={event.span_id}
          event={event}
          requesterSpanId={requesterSpanId}
          onJumpToSpan={onJumpToSpan}
        />
      );
    case "run":
    case "reasoning":
      return <GenericInspector key={event.span_id} event={event} />;
  }
}

function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (t: string) => void;
}) {
  return (
    <div className="insp-tabs">
      {tabs.map((t) => (
        <button
          key={t}
          className="insp-tab"
          data-active={t === active}
          onClick={() => onChange(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────── LLM ─────────────────── */

function LlmInspector({ event, datasetBasePath }: { event: LlmEvent; datasetBasePath: "/datasets" | "/app/datasets" }) {
  const tabs = ["Context", "Response", "Replay", "Raw"];
  // Error steps open on Response (the failure); others on Context (the money tab).
  const [active, setActive] = useState(event.error ? "Response" : "Context");

  return (
    <div className="insp">
      <InspectorTop event={event} />
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      <div className="insp-body">
        {active === "Context" && <LlmContext event={event} />}
        {active === "Response" && <LlmResponse event={event} />}
        {active === "Replay" && (
          <>
            <ReplayPanel event={event} />
            <div className="add-ds-wrap">
              <AddToDataset event={event} basePath={datasetBasePath} />
            </div>
          </>
        )}
        {active === "Raw" && <JsonView value={event} initialDepth={3} />}
      </div>
    </div>
  );
}

function LlmContext({ event }: { event: LlmEvent }) {
  const { system, messages, tools, params } = event.request;
  return (
    <div>
      <div className="insp-h">Context window — what the model saw</div>

      {system && (
        <div className="msg">
          <div className="msg-head">
            <span className="msg-role" data-role="system">
              system
            </span>
          </div>
          <div className="msg-body">{system}</div>
        </div>
      )}

      {messages.map((m, i) => (
        <MessageBlock key={i} message={m} />
      ))}

      {messages.length === 0 && !system && (
        <p className="empty">No messages captured for this call.</p>
      )}

      {tools.length > 0 && (
        <>
          <div className="insp-h">Tools in scope ({tools.length})</div>
          {tools.map((t) => (
            <div className="msg" key={t.name}>
              <div className="msg-head">
                <span className="msg-role" data-role="tool">
                  {t.name}
                </span>
                {t.description && (
                  <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>
                    {t.description}
                  </span>
                )}
              </div>
              <div style={{ padding: "0.6rem 0.85rem" }}>
                <JsonView value={t.parameters} initialDepth={1} />
              </div>
            </div>
          ))}
        </>
      )}

      <div className="insp-h">Parameters</div>
      <dl className="kv">
        <dt>model</dt>
        <dd className="mono">
          {event.model.provider}/{event.model.model_id}
        </dd>
        {params.temperature != null && (
          <>
            <dt>temperature</dt>
            <dd className="mono">{params.temperature}</dd>
          </>
        )}
        {params.max_output_tokens != null && (
          <>
            <dt>max_output</dt>
            <dd className="mono">{params.max_output_tokens}</dd>
          </>
        )}
        {params.top_p != null && (
          <>
            <dt>top_p</dt>
            <dd className="mono">{params.top_p}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

function MessageBlock({ message }: { message: ModelMessage }) {
  return (
    <div className="msg">
      <div className="msg-head">
        <span className="msg-role" data-role={message.role}>
          {message.role}
        </span>
      </div>
      <div className="msg-body">
        <RenderContent content={message.content} />
      </div>
    </div>
  );
}

/** Render AI-SDK message content: a string, or an array of typed parts. */
function RenderContent({ content }: { content: unknown }) {
  if (typeof content === "string") return <>{content}</>;
  if (Array.isArray(content)) {
    return (
      <>
        {content.map((part, i) => (
          <ContentPart key={i} part={part} />
        ))}
      </>
    );
  }
  return <JsonView value={content} initialDepth={2} />;
}

function ContentPart({ part }: { part: unknown }) {
  if (!part || typeof part !== "object") return <>{String(part)}</>;
  const p = part as Record<string, unknown>;
  const type = p.type as string | undefined;

  if (type === "text") return <span>{String(p.text ?? "")}</span>;
  if (type === "reasoning")
    return (
      <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
        {String(p.text ?? "")}
      </span>
    );
  if (type === "tool-call")
    return (
      <div style={{ marginTop: "0.4rem" }}>
        <span className="mono" style={{ color: "var(--violet)" }}>
          → {String(p.toolName ?? "")}(
        </span>
        <JsonView value={p.input ?? p.args} initialDepth={2} />
        <span className="mono" style={{ color: "var(--violet)" }}>
          )
        </span>
      </div>
    );
  if (type === "tool-result")
    return (
      <div style={{ marginTop: "0.4rem" }}>
        <span className="mono" style={{ color: "var(--emerald)" }}>
          result:
        </span>
        <JsonView value={p.output ?? p.result} initialDepth={2} />
      </div>
    );
  return <JsonView value={part} initialDepth={1} />;
}

function LlmResponse({ event }: { event: LlmEvent }) {
  const { response, usage, error } = event;
  return (
    <div>
      {error && (
        <div className="callout-error">
          <div className="ce-title">{error.name}</div>
          <div className="ce-msg">{error.message}</div>
        </div>
      )}

      <div className="insp-h">Outcome</div>
      <dl className="kv">
        <dt>finish_reason</dt>
        <dd className="mono">{response.finish_reason ?? "—"}</dd>
        {usage && (
          <>
            <dt>tokens</dt>
            <dd className="mono">
              {usage.input_tokens} in · {usage.output_tokens} out ·{" "}
              {usage.total_tokens} total
            </dd>
          </>
        )}
        {event.latency_ms != null && (
          <>
            <dt>latency</dt>
            <dd className="mono">{event.latency_ms} ms</dd>
          </>
        )}
      </dl>

      {response.reasoning && (
        <>
          <div className="insp-h">Reasoning</div>
          <div className="msg-body" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
            {response.reasoning}
          </div>
        </>
      )}

      {response.text && (
        <>
          <div className="insp-h">Text</div>
          <div className="msg-body">{response.text}</div>
        </>
      )}

      {response.tool_calls.length > 0 && (
        <>
          <div className="insp-h">
            Tool calls requested ({response.tool_calls.length})
          </div>
          {response.tool_calls.map((tc) => (
            <div className="msg" key={tc.tool_call_id}>
              <div className="msg-head">
                <span className="msg-role" data-role="tool">
                  {tc.tool_name}
                </span>
                <span className="mono" style={{ textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>
                  {tc.tool_call_id}
                </span>
              </div>
              <div style={{ padding: "0.6rem 0.85rem" }}>
                <JsonView value={tc.input} initialDepth={2} />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ─────────────────── Tool ─────────────────── */

function ToolInspector({
  event,
  requesterSpanId,
  onJumpToSpan,
}: {
  event: ToolEvent;
  requesterSpanId: string | null;
  onJumpToSpan: (spanId: string) => void;
}) {
  const tabs = ["Tool I/O", "Raw"];
  const [active, setActive] = useState("Tool I/O");

  return (
    <div className="insp">
      <InspectorTop event={event} />
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      <div className="insp-body">
        {active === "Raw" ? (
          <JsonView value={event} initialDepth={3} />
        ) : (
          <div>
            {event.policy_block ? (
              <div className="callout-block">
                <div className="cb-title">⊘ Blocked by policy — never executed</div>
                <div className="cb-rule mono">{event.policy_block.rule}</div>
                <div className="cb-msg">{event.policy_block.detail}</div>
                <div className="cb-foot">A runtime guardrail stopped this action before it ran. This record is hash-chained into the audit — re-runnable proof the control fired.</div>
              </div>
            ) : event.error && (
              <div className="callout-error">
                <div className="ce-title">Tool threw — {event.error.name}</div>
                <div className="ce-msg">{event.error.message}</div>
              </div>
            )}

            <div className="insp-h">Call</div>
            <dl className="kv">
              <dt>tool</dt>
              <dd className="mono">{event.tool_name}</dd>
              <dt>call_id</dt>
              <dd className="mono">{event.tool_call_id}</dd>
              {event.latency_ms != null && (
                <>
                  <dt>latency</dt>
                  <dd className="mono">{event.latency_ms} ms</dd>
                </>
              )}
              {requesterSpanId && (
                <>
                  <dt>requested by</dt>
                  <dd>
                    <button
                      className="mono"
                      onClick={() => onJumpToSpan(requesterSpanId)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--blue)",
                        cursor: "pointer",
                        padding: 0,
                        fontSize: "0.78rem",
                      }}
                    >
                      ↑ jump to the LLM step →
                    </button>
                  </dd>
                </>
              )}
            </dl>

            <div className="insp-h">Input</div>
            <JsonView value={event.input} initialDepth={3} />

            <div className="insp-h">Output</div>
            {event.policy_block ? (
              <p className="empty">No output — blocked by policy before execution.</p>
            ) : event.error ? (
              <p className="empty">No output — the tool threw (see error above).</p>
            ) : (
              <JsonView value={event.output} initialDepth={3} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── Run / Reasoning ─────────────────── */

function GenericInspector({ event }: { event: RunEvent | ReasoningEvent }) {
  const tabs = ["Overview", "Raw"];
  const [active, setActive] = useState("Overview");

  return (
    <div className="insp">
      <InspectorTop event={event} />
      <Tabs tabs={tabs} active={active} onChange={setActive} />
      <div className="insp-body">
        {active === "Raw" ? (
          <JsonView value={event} initialDepth={4} />
        ) : event.type === "run" ? (
          <div>
            {event.error && (
              <div className="callout-error">
                <div className="ce-title">{event.error.name}</div>
                <div className="ce-msg">{event.error.message}</div>
              </div>
            )}
            <div className="insp-h">Run {event.phase}</div>
            <dl className="kv">
              <dt>name</dt>
              <dd>{event.name}</dd>
              {event.status && (
                <>
                  <dt>status</dt>
                  <dd>
                    <span className={`pill pill-${event.status}`}>
                      {event.status}
                    </span>
                  </dd>
                </>
              )}
            </dl>
            {event.input != null && (
              <>
                <div className="insp-h">Input</div>
                <JsonView value={event.input} initialDepth={3} />
              </>
            )}
            {event.output != null && (
              <>
                <div className="insp-h">Output</div>
                <JsonView value={event.output} initialDepth={3} />
              </>
            )}
            {Object.keys(event.metadata).length > 0 && (
              <>
                <div className="insp-h">Metadata</div>
                <JsonView value={event.metadata} initialDepth={2} />
              </>
            )}
          </div>
        ) : (
          <div>
            <div className="insp-h">{event.graph_node?.name ?? event.label ?? "Reasoning"}</div>
            {event.graph_node && (
              <dl className="kv">
                <dt>graph node</dt>
                <dd className="mono">{event.graph_node.name}</dd>
                {event.routed_from && event.routed_from.length > 0 && (
                  <>
                    <dt>routed from</dt>
                    <dd className="mono">{event.routed_from.join(", ")}</dd>
                  </>
                )}
              </dl>
            )}
            <div className="msg-body">{event.text}</div>
          </div>
        )}
      </div>
    </div>
  );
}
