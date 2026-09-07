"use client";

import { useEffect, useRef } from "react";

/**
 * The brand's generative background — an amber/teal aurora wash behind a
 * sparse, drifting constellation of chain-nodes, plus a fine grain pass.
 * Same idea as the hero's live hash-chain trace, just running at ambient
 * scale.
 *
 * Render as the first child of a `position: relative` container with class
 * `ambient-host` (e.g. a hero section) — it fills that container via
 * `.ambient-field { position: absolute; inset: 0 }`, not the viewport, and
 * its RAF loop only runs while mounted. Deliberately per-section, not a
 * single global instance in the root layout: a global instance would keep
 * an animation loop running on every page even when off-screen, which is
 * exactly the kind of thing that makes an app feel slow.
 *
 * Respects prefers-reduced-motion by freezing on the first frame.
 */
export default function AmbientField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, raf = 0;

    function styleColor(name: string): string {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }
    function hexToRgb(hex: string): [number, number, number] {
      const m = hex.replace("#", "");
      const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    // Measure the PARENT (.ambient-host), never the canvas itself: writing
    // canvas.width/height changes the canvas's own intrinsic box size, so
    // observing the canvas would re-trigger the observer on every resize()
    // call — a feedback loop with no natural ceiling (it ran away to the
    // browser's max canvas dimension, ~16.7M px, in testing).
    const host = canvas.parentElement;
    function resize() {
      if (!canvas || !ctx || !host) return;
      const r = host.getBoundingClientRect();
      // Defense in depth against any future sizing feedback loop: no
      // section this mounts in is ever legitimately taller/wider than a
      // few thousand px, so clamp rather than let a runaway value reach
      // the browser's actual canvas size ceiling.
      w = Math.min(r.width, 4000);
      h = Math.min(r.height, 4000);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = host ? new ResizeObserver(resize) : null;
    if (host) ro!.observe(host);

    // Fine grain tile, rendered once, reused as a repeating pattern.
    const grainCanvas = document.createElement("canvas");
    grainCanvas.width = 128;
    grainCanvas.height = 128;
    const gctx = grainCanvas.getContext("2d")!;
    const imgData = gctx.createImageData(128, 128);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const v = Math.floor(Math.random() * 255);
      imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = v;
      imgData.data[i + 3] = 14;
    }
    gctx.putImageData(imgData, 0, 0);
    const grainPattern = ctx.createPattern(grainCanvas, "repeat");

    const blobs = [
      { x: 0.18, y: 0.1, r: 0.42, hue: "brand" as const, phase: 0 },
      { x: 0.85, y: 0.22, r: 0.36, hue: "brand2" as const, phase: 2.1 },
      { x: 0.55, y: -0.05, r: 0.3, hue: "brand" as const, phase: 4.3 },
    ];

    const NODE_COUNT = Math.round(Math.min(60, (w * h) / 20000));
    // Nodes use the full 0..1 box now — this canvas is scoped to its own
    // section container (e.g. the hero), not a tall page, so there's no
    // "below the fold" region to keep clear of.
    const nodes = Array.from({ length: NODE_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00012,
      vy: (Math.random() - 0.5) * 0.00012,
      r: Math.random() * 1.4 + 0.6,
    }));

    let t = 0;

    function draw() {
      if (!ctx) return;
      const brandHex = styleColor("--brand") || "#e8873d";
      const brand2Hex = styleColor("--brand-2") || "#3ecfb8";
      const inkHex = styleColor("--text-primary") || "#f0f0f8";
      const [br, bg, bb] = hexToRgb(brandHex);
      const [vr, vg, vb] = hexToRgb(brand2Hex);
      const [ir, ig, ib] = hexToRgb(inkHex);

      ctx.clearRect(0, 0, w, h);

      for (const b of blobs) {
        const bx = w * (b.x + (reduceMotion ? 0 : Math.sin(t * 0.0003 + b.phase) * 0.03));
        const by = h * (b.y + (reduceMotion ? 0 : Math.cos(t * 0.00022 + b.phase) * 0.02));
        const rad = Math.max(w, h) * b.r;
        const [cr, cg, cb] = b.hue === "brand" ? [br, bg, bb] : [vr, vg, vb];
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.16)`);
        grad.addColorStop(0.55, `rgba(${cr},${cg},${cb},0.05)`);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      if (!reduceMotion) {
        for (const n of nodes) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < -0.02) n.x = 1.02;
          if (n.x > 1.02) n.x = -0.02;
          if (n.y < -0.02) n.y = 1.02;
          if (n.y > 1.02) n.y = -0.02;
        }
      }
      const linkDist = Math.min(w, h) * 0.11;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b2 = nodes[j];
          const dx = (a.x - b2.x) * w, dy = (a.y - b2.y) * h;
          const d = Math.hypot(dx, dy);
          if (d < linkDist) {
            ctx.strokeStyle = `rgba(${ir},${ig},${ib},${0.05 * (1 - d / linkDist)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x * w, a.y * h);
            ctx.lineTo(b2.x * w, b2.y * h);
            ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x * w, n.y * h, n.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ir},${ig},${ib},0.28)`;
        ctx.fill();
      }

      if (grainPattern) {
        ctx.fillStyle = grainPattern;
        ctx.fillRect(0, 0, w, h);
      }

      t += 16;
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} className="ambient-field" aria-hidden />;
}
