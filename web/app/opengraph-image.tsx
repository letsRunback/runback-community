import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Runback — the flight recorder for AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Branded social card. Uses the system default font (no external fetch) for build safety. */
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0b0d",
          backgroundImage:
            "radial-gradient(900px 500px at 78% -10%, rgba(232,135,61,0.16), transparent), radial-gradient(700px 500px at 8% 100%, rgba(62,207,184,0.12), transparent), linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 100% 100%, 56px 56px, 56px 56px",
          padding: "72px 80px",
          color: "#f2f0ea",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", width: 46, height: 46, borderRadius: 12, background: "#15171b", border: "1px solid rgba(242,240,234,0.16)", alignItems: "center", justifyContent: "center" }}>
            <div style={{ display: "flex", width: 20, height: 20, borderRadius: 5, background: "linear-gradient(135deg, #e8873d, #3ecfb8)" }} />
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>Runback</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 68,
              fontWeight: 700,
              letterSpacing: -3,
              lineHeight: 1.08,
              maxWidth: 980,
            }}
          >
            <span>Deploy AI agents</span>
            <span style={{ color: "#e8873d" }}>you can prove are safe.</span>
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#8f8fa8", maxWidth: 900, lineHeight: 1.4 }}>
            The behavioural system of record for AI agents.
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, fontSize: 22, color: "#545470" }}>
          <span>Observe</span>
          <span>·</span>
          <span>Replay</span>
          <span>·</span>
          <span>Gate</span>
          <span>·</span>
          <span>Audit</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
