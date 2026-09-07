import { describe, it, expect } from "vitest";
import { mapOtlpToEvents } from "../lib/otel/mapper";
import type { LlmEvent, ToolEvent, RunEvent, ReasoningEvent } from "@runback/schema";

// OTLP/HTTP JSON attribute helpers
const sv = (s: string) => ({ stringValue: s });
const iv = (n: number) => ({ intValue: String(n) });
const a = (key: string, value: unknown) => ({ key, value });

function trace(spans: unknown[]) {
  return { resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: {}, spans }] }] };
}

describe("OTel mapper — Traceloop / OpenLLMetry indexed attributes", () => {
  const body = trace([
    {
      traceId: "t1",
      spanId: "root",
      name: "agent",
      startTimeUnixNano: "1000000000",
      endTimeUnixNano: "5000000000",
      attributes: [a("input.value", sv("do research"))],
    },
    {
      traceId: "t1",
      spanId: "llm1",
      parentSpanId: "root",
      name: "chat",
      startTimeUnixNano: "2000000000",
      endTimeUnixNano: "3000000000",
      attributes: [
        a("gen_ai.system", sv("groq")),
        a("gen_ai.request.model", sv("gpt-oss-120b")),
        a("gen_ai.request.temperature", { doubleValue: 0.7 }),
        a("gen_ai.prompt.0.role", sv("system")),
        a("gen_ai.prompt.0.content", sv("You are helpful")),
        a("gen_ai.prompt.1.role", sv("user")),
        a("gen_ai.prompt.1.content", sv("hi there")),
        a("gen_ai.completion.0.role", sv("assistant")),
        a("gen_ai.completion.0.content", sv("hello!")),
        a("gen_ai.usage.input_tokens", iv(10)),
        a("gen_ai.usage.output_tokens", iv(5)),
        a("gen_ai.response.finish_reason", sv("stop")),
      ],
    },
    {
      traceId: "t1",
      spanId: "tool1",
      parentSpanId: "root",
      name: "execute_tool",
      startTimeUnixNano: "3000000000",
      endTimeUnixNano: "3500000000",
      attributes: [
        a("gen_ai.operation.name", sv("execute_tool")),
        a("gen_ai.tool.name", sv("web_search")),
        a("input.value", sv(JSON.stringify({ query: "x" }))),
        a("output.value", sv(JSON.stringify({ results: [] }))),
      ],
    },
  ]);

  const events = mapOtlpToEvents(body);

  it("produces run-start, llm, tool, run-end in order", () => {
    expect(events.map((e) => e.type)).toEqual(["run", "llm", "tool", "run"]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(events.every((e) => e.run_id === "t1")).toBe(true);
  });

  it("maps the run envelope", () => {
    const start = events[0] as RunEvent;
    expect(start.phase).toBe("start");
    expect(start.name).toBe("agent");
    expect(start.input).toBe("do research");
    expect(start.span_id).toBe("run:t1");
    expect((events[3] as RunEvent).phase).toBe("end");
    expect((events[3] as RunEvent).status).toBe("success");
  });

  it("maps the LLM span fully", () => {
    const llm = events[1] as LlmEvent;
    expect(llm.model).toEqual({ provider: "groq", model_id: "gpt-oss-120b" });
    expect(llm.request.system).toBe("You are helpful");
    expect(llm.request.messages).toEqual([{ role: "user", content: "hi there" }]);
    expect(llm.request.params.temperature).toBe(0.7);
    expect(llm.response.text).toBe("hello!");
    expect(llm.response.finish_reason).toBe("stop");
    expect(llm.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
    expect(llm.latency_ms).toBe(1000);
    // parent 'root' was a non-GenAI span → re-parented under the run
    expect(llm.parent_span_id).toBe("run:t1");
  });

  it("maps the tool span", () => {
    const tool = events[2] as ToolEvent;
    expect(tool.tool_name).toBe("web_search");
    expect(tool.input).toEqual({ query: "x" });
    expect(tool.output).toEqual({ results: [] });
    expect(tool.parent_span_id).toBe("run:t1");
  });
});

describe("OTel mapper — OpenInference single-span (collision guard)", () => {
  const body = trace([
    {
      traceId: "t2",
      spanId: "oi1",
      name: "llm",
      startTimeUnixNano: "1000000000",
      endTimeUnixNano: "2000000000",
      attributes: [
        a("openinference.span.kind", sv("LLM")),
        a("llm.model_name", sv("gpt-4o")),
        a("input.value", sv(JSON.stringify({ messages: [{ role: "user", content: "hey" }] }))),
        a("output.value", sv("yo")),
        a("llm.token_count.prompt", iv(3)),
        a("llm.token_count.completion", iv(2)),
      ],
    },
  ]);

  const events = mapOtlpToEvents(body);

  it("does not collide the run id with the root content span", () => {
    expect(events).toHaveLength(3);
    const ids = events.map((e) => e.span_id);
    expect(new Set(ids).size).toBe(3); // all unique
    const llm = events[1] as LlmEvent;
    expect(llm.span_id).toBe("oi1");
    expect(events[0].span_id).toBe("run:t2");
    expect(llm.parent_span_id).toBe("run:t2");
  });

  it("maps OpenInference fields", () => {
    const llm = events[1] as LlmEvent;
    expect(llm.model.model_id).toBe("gpt-4o");
    expect(llm.request.messages).toEqual([{ role: "user", content: "hey" }]);
    expect(llm.response.text).toBe("yo");
    expect(llm.usage?.total_tokens).toBe(5);
  });
});

describe("OTel mapper — agent-step spans + fidelity", () => {
  const body = trace([
    { traceId: "t4", spanId: "root", name: "agent", startTimeUnixNano: "1000000000", endTimeUnixNano: "9000000000",
      attributes: [a("openinference.span.kind", sv("AGENT"))] },
    { traceId: "t4", spanId: "retr", parentSpanId: "root", name: "vector_search", startTimeUnixNano: "2000000000", endTimeUnixNano: "2500000000",
      attributes: [a("openinference.span.kind", sv("RETRIEVER")), a("input.value", sv("find docs"))] },
    { traceId: "t4", spanId: "llmx", parentSpanId: "retr", name: "chat", startTimeUnixNano: "3000000000", endTimeUnixNano: "4000000000",
      attributes: [a("gen_ai.request.model", sv("m"))] },
    { traceId: "t4", spanId: "mystery", parentSpanId: "root", name: "internal", startTimeUnixNano: "5000000000", endTimeUnixNano: "5100000000",
      attributes: [a("custom.attr", sv("x"))] },
  ]);
  const events = mapOtlpToEvents(body);

  it("emits a reasoning marker for the retriever and preserves hierarchy", () => {
    const reasoning = events.find((e) => e.type === "reasoning") as ReasoningEvent;
    expect(reasoning).toBeTruthy();
    expect(reasoning.label).toBe("retriever");
    expect(reasoning.text).toContain("find docs");
    // the llm under the retriever keeps the retriever as parent (structure preserved)
    const llm = events.find((e) => e.type === "llm")!;
    expect(llm.parent_span_id).toBe("retr");
  });

  it("counts the unknown span in run metadata — never silently dropped", () => {
    expect((events[0] as RunEvent).metadata.dropped_spans).toBe(1);
  });

  it("falls back tool_call_id to the span id when the instrumentor omits it", () => {
    const tb = trace([
      { traceId: "t5", spanId: "root", name: "a", startTimeUnixNano: "1000000000", endTimeUnixNano: "3000000000", attributes: [] },
      { traceId: "t5", spanId: "toolz", parentSpanId: "root", name: "execute_tool", startTimeUnixNano: "2000000000", endTimeUnixNano: "2500000000",
        attributes: [a("gen_ai.tool.name", sv("search"))] },
    ]);
    const tool = mapOtlpToEvents(tb).find((e) => e.type === "tool") as ToolEvent;
    expect(tool.tool_call_id).toBe("toolz");
  });
});

describe("OTel mapper — edges", () => {
  it("returns [] when there are no spans", () => {
    expect(mapOtlpToEvents({ resourceSpans: [] })).toEqual([]);
    expect(mapOtlpToEvents({})).toEqual([]);
  });

  it("flags an errored span", () => {
    const body = trace([
      {
        traceId: "t3",
        spanId: "x",
        name: "chat",
        startTimeUnixNano: "1000000000",
        endTimeUnixNano: "2000000000",
        attributes: [a("gen_ai.request.model", sv("m"))],
        status: { code: 2, message: "boom" },
      },
    ]);
    const events = mapOtlpToEvents(body);
    const llm = events[1] as LlmEvent;
    expect(llm.error?.message).toBe("boom");
    expect((events[2] as RunEvent).status).toBe("error");
  });

  it("drops a span missing traceId or spanId instead of emitting a run_id: undefined event", () => {
    // A span with no traceId/spanId can't be grouped into a run. Letting it through
    // used to produce a TraceEvent with run_id (or span_id) `undefined` — JSON.stringify
    // drops undefined keys, so the DB insert silently omitted the NOT NULL run_id
    // column and storeEvents() threw, aborting the whole ingest batch (including any
    // other well-formed traces sent in the same export).
    const malformed = { traceId: "", spanId: "s1", name: "chat", attributes: [a("gen_ai.request.model", sv("m"))] };
    const missingSpanId = { traceId: "t9", name: "chat", attributes: [a("gen_ai.request.model", sv("m"))] };
    expect(mapOtlpToEvents(trace([malformed]))).toEqual([]);
    expect(mapOtlpToEvents(trace([missingSpanId]))).toEqual([]);

    // A well-formed trace in the SAME export must still come through untouched.
    const mixed = mapOtlpToEvents({
      resourceSpans: [
        { scopeSpans: [{ spans: [malformed] }] },
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "t10",
                  spanId: "good",
                  name: "chat",
                  startTimeUnixNano: "1000000000",
                  endTimeUnixNano: "2000000000",
                  attributes: [a("gen_ai.request.model", sv("m"))],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(mixed.every((e) => e.run_id === "t10")).toBe(true);
    expect(mixed.length).toBeGreaterThan(0);
  });
});

describe("OTel mapper — graph.node.* attributes (OpenInference generic graph topology)", () => {
  it("populates graph_node/routed_from on a reasoning marker when the attributes are present", () => {
    const body = trace([
      { traceId: "t11", spanId: "root", name: "agent", startTimeUnixNano: "1000000000", endTimeUnixNano: "5000000000", attributes: [] },
      {
        traceId: "t11", spanId: "chain1", parentSpanId: "root", name: "step", startTimeUnixNano: "2000000000", endTimeUnixNano: "2500000000",
        attributes: [
          a("openinference.span.kind", sv("CHAIN")),
          a("graph.node.name", sv("triage")),
          a("graph.node.parent_id", sv("intake")),
        ],
      },
    ]);
    const reasoning = mapOtlpToEvents(body).find((e) => e.type === "reasoning") as ReasoningEvent;
    expect(reasoning.graph_node).toEqual({ name: "triage" });
    expect(reasoning.routed_from).toEqual(["intake"]);
  });

  it("threads graph_node onto an LLM event's metadata when present on that span", () => {
    const body = trace([
      { traceId: "t12", spanId: "root", name: "agent", startTimeUnixNano: "1000000000", endTimeUnixNano: "5000000000", attributes: [] },
      {
        traceId: "t12", spanId: "llm1", parentSpanId: "root", name: "chat", startTimeUnixNano: "2000000000", endTimeUnixNano: "2500000000",
        attributes: [a("gen_ai.request.model", sv("m")), a("graph.node.name", sv("respond"))],
      },
    ]);
    const llm = mapOtlpToEvents(body).find((e) => e.type === "llm") as LlmEvent;
    expect(llm.metadata).toEqual({ graph_node: { name: "respond" } });
  });

  it("leaves graph_node/metadata unset when the attributes are absent — no regression for today's default LangChain/LangGraph instrumentor output", () => {
    const body = trace([
      { traceId: "t13", spanId: "root", name: "agent", startTimeUnixNano: "1000000000", endTimeUnixNano: "5000000000", attributes: [] },
      {
        traceId: "t13", spanId: "chain1", parentSpanId: "root", name: "step", startTimeUnixNano: "2000000000", endTimeUnixNano: "2500000000",
        attributes: [a("openinference.span.kind", sv("CHAIN"))],
      },
      {
        traceId: "t13", spanId: "llm1", parentSpanId: "root", name: "chat", startTimeUnixNano: "3000000000", endTimeUnixNano: "3500000000",
        attributes: [a("gen_ai.request.model", sv("m"))],
      },
    ]);
    const events = mapOtlpToEvents(body);
    const reasoning = events.find((e) => e.type === "reasoning") as ReasoningEvent;
    const llm = events.find((e) => e.type === "llm") as LlmEvent;
    expect(reasoning.graph_node).toBeUndefined();
    expect(reasoning.routed_from).toBeUndefined();
    expect(llm.metadata).toBeUndefined();
  });
});

describe("OTel mapper — redaction (closes the gap where OTel-fed integrations shipped raw PII)", () => {
  it("redacts email/secret-shaped content in the LLM request and response", () => {
    const body = trace([
      { traceId: "t14", spanId: "root", name: "agent", startTimeUnixNano: "1000000000", endTimeUnixNano: "5000000000", attributes: [] },
      {
        traceId: "t14", spanId: "llm1", parentSpanId: "root", name: "chat", startTimeUnixNano: "2000000000", endTimeUnixNano: "3000000000",
        attributes: [
          a("gen_ai.request.model", sv("gpt-4o")),
          a("gen_ai.prompt.0.role", sv("user")),
          a("gen_ai.prompt.0.content", sv("my email is jane@example.com and my key is sk-ant-abcdefghijklmnopqrstuvwx")),
          a("gen_ai.completion.0.role", sv("assistant")),
          a("gen_ai.completion.0.content", sv("got it, jane@example.com")),
        ],
      },
    ]);
    const events = mapOtlpToEvents(body);
    const llm = events.find((e) => e.type === "llm") as LlmEvent;
    const requestText = JSON.stringify(llm.request.messages);
    const responseText = llm.response.text ?? "";
    expect(requestText).not.toContain("jane@example.com");
    expect(requestText).not.toContain("sk-ant-");
    expect(responseText).not.toContain("jane@example.com");
    expect(requestText).toContain("[redacted:email]");
  });

  it("redacts tool input/output", () => {
    const body = trace([
      { traceId: "t15", spanId: "root", name: "agent", startTimeUnixNano: "1000000000", endTimeUnixNano: "5000000000", attributes: [] },
      {
        traceId: "t15", spanId: "tool1", parentSpanId: "root", name: "lookup", startTimeUnixNano: "2000000000", endTimeUnixNano: "2500000000",
        attributes: [
          a("gen_ai.tool.name", sv("lookup_customer")),
          a("input.value", sv(JSON.stringify({ email: "customer@acme.com" }))),
          a("output.value", sv(JSON.stringify({ ssn: "123-45-6789" }))),
        ],
      },
    ]);
    const events = mapOtlpToEvents(body);
    const tool = events.find((e) => e.type === "tool") as ToolEvent;
    expect(JSON.stringify(tool.input)).not.toContain("customer@acme.com");
    expect(JSON.stringify(tool.output)).not.toContain("123-45-6789");
  });
});
