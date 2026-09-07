import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Fraunces } from "next/font/google";
import { siteUrl } from "@/lib/deployment";
import Analytics from "@/components/Analytics";
import "./globals.css";

// Fraunces: an editorial serif for big display numbers in the control room —
// the "executive dashboard" voice. Used only inside /app.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-display",
  display: "swap",
});

// IBM Plex: enterprise-infrastructure heritage. The mono carries the
// "instrument readout" voice (spans, timestamps, metrics) across the product.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

const TITLE = "Runback — Deploy AI agents you can prove are safe";
const DESCRIPTION =
  "The behavioural record for AI agents — signed, verifiable, and yours to prove independently of us. Observe every decision, replay any incident, and block a tool call against your own runtime rules before it executes — with your data never leaving your perimeter.";

// Self-hosted deployments set NEXT_PUBLIC_APP_URL to their own domain (see
// docker-compose.yml, which hard-fails `docker compose up` without it), but
// that env var only exists in the running container, not at `docker build`
// time — same reasoning as RUNBACK_SELF_HOSTED elsewhere in this codebase
// (docs/page.tsx, login/page.tsx). Reading it inside generateMetadata()
// rather than a static `metadata` object defers the read to request time for
// every route that opts into dynamic rendering, instead of baking
// runback.dev in at build time regardless of where this is actually running.
// siteUrl() itself lives in lib/deployment.ts, shared with the SCIM discovery
// routes, which have the identical requirement and used to hardcode
// runback.dev with no fallback logic at all.

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: new URL(siteUrl()),
    // The suffix carries real disambiguation, not just branding: "Runback" is
    // also a Steam fighting game, a peer-to-peer betting app at runback.io,
    // and established fighting-game-community slang for a rematch — a bare
    // "· Runback" on every page title does nothing to tell a search engine
    // (or a skimming human) which "Runback" this is. The domain itself does
    // that job in four characters instead of a marketing tagline repeated
    // verbatim across 30+ tab titles (".dev" isn't the game or the betting
    // app either, so it's just as disambiguating without reading like
    // SEO keyword-stuffing on every page). Every page inherits this once,
    // so fixing it here fixes it site-wide.
    title: { default: TITLE, template: "%s · Runback.dev" },
    description: DESCRIPTION,
    applicationName: "Runback",
    keywords: [
      "AI agent governance",
      "AI agent audit",
      "AI agent observability",
      "AI compliance",
      "regulated AI deployment",
      "agent incident replay",
      "AI risk management",
      "APRA CPS 230 AI",
      "EU AI Act traceability",
      "LLM eval gate",
    ],
    authors: [{ name: "Runback" }],
    creator: "Runback",
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: siteUrl(),
      siteName: "Runback",
      title: TITLE,
      description: DESCRIPTION,
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

function jsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Runback",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web, Self-hosted",
    description: DESCRIPTION,
    url: siteUrl(),
    // AUD, matching what the Lemon Squeezy store actually charges. A
    // priceCurrency that disagrees with checkout is a rich-result that
    // misquotes you in Google before anyone reaches the site.
    offers: { "@type": "Offer", price: "0", priceCurrency: "AUD" },
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} ${fraunces.variable}`}>
      <body>
        {children}
        <Analytics />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()) }}
        />
      </body>
    </html>
  );
}
