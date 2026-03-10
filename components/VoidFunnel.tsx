"use client";
import { useEffect, useRef } from "react";

interface VoidFunnelProps {
  dragging?: boolean;
}

export default function VoidFunnel({ dragging = false }: VoidFunnelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dragVal = useRef(0); // 0 = idle, 1 = dragging (lerped)
  const dragTarget = useRef(0);

  useEffect(() => {
    dragTarget.current = dragging ? 1 : 0;
  }, [dragging]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;

    const resize = () => {
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();

    function draw(time: number) {
      if (!ctx) return;
      // Smooth drag interpolation
      dragVal.current += (dragTarget.current - dragVal.current) * 0.04;
      const d = dragVal.current;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#ebebeb";
      ctx.fillRect(0, 0, W, H);

      // Funnel center
      const cx = W * 0.5;
      const cy = H * 0.5;

      // Geometry
      const viewSize = Math.max(W, H);
      const outerR = viewSize * 0.85;
      const funnelR = viewSize * 0.21;
      const holeR = 12;
      const depth = 420 + d * 180; // pulls deeper when dragging

      // Camera
      const focalLen = 620;
      const tilt = 0.28 + d * 0.15; // tilts more into hole when dragging
      const cosA = Math.cos(tilt);
      const sinA = Math.sin(tilt);

      // Very slow rotation (~1 full turn per 10 min)
      const rot = time * 0.0000105;

      function project(r: number, theta: number): [number, number] {
        let sr = r;
        let sz = 0;

        if (r < funnelR) {
          const t = r / funnelR; // 0 at center, 1 at rim
          sr = holeR + (funnelR - holeR) * Math.pow(t, 0.55);
          sz = depth * Math.pow(1 - t, 2.0);
        }

        const x3 = sr * Math.cos(theta + rot);
        const y3 = sr * Math.sin(theta + rot);
        const z3 = sz;

        // Tilt camera (rotate around X)
        const yt = y3 * cosA - z3 * sinA;
        const zt = y3 * sinA + z3 * cosA;

        // Perspective
        const s = focalLen / (focalLen + zt);
        return [cx + x3 * s, cy + yt * s];
      }

      const RINGS = 65;
      const RADIALS = 60;
      const ARC_RES = 200;
      const LINE_RES = 90;

      // --- Concentric rings ---
      for (let i = 1; i <= RINGS; i++) {
        const r = (i / RINGS) * outerR;

        // Opacity: fade at far edges, strengthen inside funnel
        let alpha: number;
        if (r > viewSize * 0.55) {
          alpha = 0.08 * Math.max(0, 1 - (r - viewSize * 0.55) / (viewSize * 0.32));
        } else if (r < funnelR) {
          alpha = 0.07 + 0.18 * Math.pow(1 - r / funnelR, 0.6);
        } else {
          alpha = 0.08;
        }

        if (alpha < 0.005) continue;

        ctx.strokeStyle = `rgba(30, 30, 30, ${alpha})`;
        ctx.lineWidth = r < funnelR * 0.25 ? 0.9 : r < funnelR ? 0.6 : 0.4;
        ctx.beginPath();

        for (let j = 0; j <= ARC_RES; j++) {
          const theta = (j / ARC_RES) * Math.PI * 2;
          const [x, y] = project(r, theta);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // --- Radial lines ---
      for (let j = 0; j < RADIALS; j++) {
        const theta = (j / RADIALS) * Math.PI * 2;

        ctx.strokeStyle = "rgba(30, 30, 30, 0.06)";
        ctx.lineWidth = 0.4;
        ctx.beginPath();

        for (let i = 0; i <= LINE_RES; i++) {
          const r = (i / LINE_RES) * outerR;
          const [x, y] = project(r, theta);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
