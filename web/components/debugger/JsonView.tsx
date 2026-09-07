"use client";

import { useState } from "react";

/** Collapsible, syntax-tinted JSON tree. The shared primitive for every inspector tab. */
export default function JsonView({
  value,
  initialDepth = 2,
}: {
  value: unknown;
  initialDepth?: number;
}) {
  return (
    <div className="json">
      <Node value={value} depth={0} initialDepth={initialDepth} k={null} />
    </div>
  );
}

function Node({
  value,
  depth,
  initialDepth,
  k,
}: {
  value: unknown;
  depth: number;
  initialDepth: number;
  k: string | null;
}) {
  const [open, setOpen] = useState(depth < initialDepth);
  const keyPart =
    k !== null ? <span className="json-key">{JSON.stringify(k)}</span> : null;
  const colon = k !== null ? <span className="json-punct">: </span> : null;

  if (value === null || value === undefined) {
    return (
      <Line>
        {keyPart}
        {colon}
        <span className="json-null">null</span>
      </Line>
    );
  }

  if (typeof value === "string") {
    // strings can be long (prompts, tool results) — render multiline
    return (
      <Line>
        {keyPart}
        {colon}
        <span className="json-string json-pre">{JSON.stringify(value)}</span>
      </Line>
    );
  }
  if (typeof value === "number") {
    return (
      <Line>
        {keyPart}
        {colon}
        <span className="json-number">{String(value)}</span>
      </Line>
    );
  }
  if (typeof value === "boolean") {
    return (
      <Line>
        {keyPart}
        {colon}
        <span className="json-bool">{String(value)}</span>
      </Line>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);

  const open_b = isArray ? "[" : "{";
  const close_b = isArray ? "]" : "}";

  if (entries.length === 0) {
    return (
      <Line>
        {keyPart}
        {colon}
        <span className="json-punct">
          {open_b}
          {close_b}
        </span>
      </Line>
    );
  }

  return (
    <div>
      <Line>
        <span className="json-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "▾ " : "▸ "}
        </span>
        {keyPart}
        {colon}
        <span className="json-punct">{open_b}</span>
        {!open && (
          <span className="json-punct" style={{ opacity: 0.6 }}>
            {" "}
            {entries.length} {isArray ? "items" : "keys"} {close_b}
          </span>
        )}
      </Line>
      {open && (
        <div style={{ paddingLeft: "1.1rem" }}>
          {entries.map(([ek, ev]) => (
            <Node
              key={ek}
              k={ek}
              value={ev}
              depth={depth + 1}
              initialDepth={initialDepth}
            />
          ))}
          <Line>
            <span className="json-punct">{close_b}</span>
          </Line>
        </div>
      )}
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
