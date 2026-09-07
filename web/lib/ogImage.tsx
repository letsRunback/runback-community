import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * Shared branded social card renderer. Every route-level opengraph-image.tsx
 * calls this with its own eyebrow/title/subtitle so shares of that specific
 * page (a blog post, a /vs page) preview distinctly instead of falling back
 * to the one generic site-wide card.
 */
export function renderOgImage(opts: {
  eyebrow: string;
  eyebrowColor?: string;
  title: string;
  titleAccent?: string;
  subtitle: string;
}) {
  const { eyebrow, eyebrowColor = "#4f9cf9", title, titleAccent, subtitle } = opts;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#09090e",
          backgroundImage:
            "radial-gradient(900px 500px at 78% -10%, rgba(79,156,249,0.18), transparent), linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 56px 56px, 56px 56px",
          padding: "72px 80px",
          color: "#f0f0f8",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ width: 38, height: 9, borderRadius: 5, background: "#4f9cf9" }} />
            <div style={{ width: 48, height: 9, borderRadius: 5, background: "#7c5cfc" }} />
            <div style={{ width: 26, height: 9, borderRadius: 5, background: "#f43f5e" }} />
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>Runback</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: eyebrowColor, letterSpacing: 1 }}>
            {eyebrow.toUpperCase()}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: -2.5,
              lineHeight: 1.12,
              maxWidth: 1000,
            }}
          >
            <span>{title}</span>
            {titleAccent && <span style={{ color: "#7c5cfc" }}>{titleAccent}</span>}
          </div>
          <div style={{ display: "flex", fontSize: 27, color: "#8f8fa8", maxWidth: 920, lineHeight: 1.4 }}>
            {subtitle}
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
    { ...OG_SIZE }
  );
}
