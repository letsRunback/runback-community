import type { Metadata } from "next";

/**
 * /demo is a client component, so its metadata lives here — a page with
 * "use client" cannot export metadata, which is why this page previously had
 * none and silently inherited the root canonical pointing at the homepage.
 */
export const metadata: Metadata = {
  title: "Book a walkthrough",
  description:
    "See Runback replay a real agent failure, gate a model upgrade, and produce a signed audit record — on your own scenario.",
  alternates: { canonical: "/demo" },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
