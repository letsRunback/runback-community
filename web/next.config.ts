import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Import the workspace schema package straight from TypeScript source.
  transpilePackages: ["@runback/schema"],

  turbopack: {
    /**
     * The monorepo root, stated rather than inferred.
     *
     * Turbopack infers a workspace root by walking up for a lockfile, and in a
     * plain checkout it guesses right. It does NOT when the tree is somewhere
     * unusual — scripts/verify-community-build.sh builds a stripped copy of
     * the repo in a temp directory, and the build failed there with "Next.js
     * inferred your workspace root, but it may not be correct… couldn't find
     * the Next.js package". Same source, same lockfile, different absolute
     * path: the inference is positional, so it is a poor thing to depend on.
     *
     * Resolved from this file's own location (web/ -> repo root), so it is
     * correct wherever the repository is checked out, including CI, a
     * container, or that temp worktree.
     */
    root: path.join(__dirname, ".."),
  },

  /**
   * /replay and /depth were merged into /how-it-works.
   *
   * Both were orphans — in neither the header, the footer, nor the sitemap — so
   * the only way to reach either was to type the URL or follow an old external
   * link. /replay restated the "logs can't answer what if?" argument that
   * /how-it-works and /proof already make; /depth was literally titled "How
   * Runback works — depth" and covered the same five steps. Its two diagrams
   * (the hash chain and the Merkle tree) moved into the Audit section of
   * /how-it-works rather than being lost.
   *
   * Permanent, so anything already linking to them consolidates onto the page
   * that survived instead of hitting a 404.
   */
  async redirects() {
    return [
      { source: "/replay", destination: "/how-it-works", permanent: true },
      { source: "/depth", destination: "/how-it-works", permanent: true },
      // /why and /proof argued the same point as /how-it-works at different
      // altitudes — three pages, ~6,500 words, one idea. Their distinctive
      // content (the competitive argument, the incident walkthrough) moved into
      // /how-it-works; the URLs redirect so nothing loses its inbound links.
      { source: "/why", destination: "/how-it-works", permanent: true },
      { source: "/proof", destination: "/how-it-works", permanent: true },
      // /standard, /kit: IA simplification pass. Each restated an argument
      // another page already made — /standard's model-neutrality pitch
      // duplicates /how-it-works and /vs, /kit was a condensed rehash of
      // /enterprise + /pricing for forwarding to a VP. Redirects so existing
      // inbound links land somewhere real instead of 404ing.
      //
      // /use-cases itself is no longer in this list: it was retired here as a
      // duplicate of the Observe/Replay/Gate/Audit stages on /how-it-works,
      // but a CTO evaluator flagged that neither /how-it-works nor anywhere
      // else on the site maps those stages to actual problems solved, by
      // persona and by scale, end to end — a genuinely different job than the
      // mechanism walkthrough. /use-cases is a real, distinct page again.
      { source: "/standard", destination: "/how-it-works", permanent: true },
      { source: "/kit", destination: "/enterprise", permanent: true },
      // Nothing on the site links to /signup, but it is the URL people
      // type. /login already handles both cases — it sends a magic link
      // whether or not the address has an account — so the 404 was
      // costing sign-ups for no reason. Temporary, not permanent: a real
      // /signup page may exist later, and a 308 would be cached by
      // browsers that saw it first.
      { source: "/signup", destination: "/login", permanent: false },
    ];
  },

  images: {
    // Next 16 defaults this to [75] and silently clamps anything else, so the
    // homepage product screenshots (AppDemo asks for quality={95}) were being
    // served at 75 while the dev server logged a warning on every render.
    // Detail in a UI screenshot is the whole point of those images.
    qualities: [75, 95],
  },
};

export default nextConfig;
