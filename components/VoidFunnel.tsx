"use client";
import { useEffect, useRef } from "react";

interface VoidFunnelProps {
  dragging?: boolean;
}

export default function VoidFunnel({ dragging = false }: VoidFunnelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dragVal = useRef(0);
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

      dragVal.current += (dragTarget.current - dragVal.current) * 0.04;
      const d = dragVal.current;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#ebebeb";
      ctx.fillRect(0, 0, W, H);

      // Hole position — slightly right & above center like the reference
      const cx = W * 0.53;
      const cy = H * 0.46;

      const viewSize = Math.max(W, H);
      const outerR = viewSize * 0.92;

      // Torus parameters
      // majorR = distance from wormhole center to tube center
      // minorR = radius of the tube cross-section
      const majorR = viewSize * 0.18;
      const minorR = majorR * 0.55 + d * majorR * 0.1;
      const rimR = majorR + minorR; // where tube meets flat surface

      // Camera
      const focalLen = 560;
      const tilt = 0.40 + d * 0.12; // radians — look into the hole
      const cosT = Math.cos(tilt);
      const sinT = Math.sin(tilt);

      // Very slow rotation
      const rot = time * 0.0000105;

      // 3D → 2D projection (tilt around X axis + perspective)
      function proj(x3: number, y3: number, z3: number): [number, number] {
        const yt = y3 * cosT - z3 * sinT;
        const zt = y3 * sinT + z3 * cosT;
        const s = focalLen / (focalLen + zt);
        return [cx + x3 * s, cy + yt * s];
      }

      // Point on the flat grid surface at radius r
      function flatPt(r: number, theta: number): [number, number] {
        return proj(
          r * Math.cos(theta + rot),
          r * Math.sin(theta + rot),
          0
        );
      }

      // Point on the torus tube surface at angle phi around the tube
      // phi=0 → outer rim (meets flat surface), phi→pi → inner back wall
      function tubePt(phi: number, theta: number): [number, number] {
        const r = majorR + minorR * Math.cos(phi);
        const z = minorR * Math.sin(phi);
        return proj(
          r * Math.cos(theta + rot),
          r * Math.sin(theta + rot),
          z
        );
      }

      // Grid density
      const FLAT_RINGS = 42;
      const TUBE_RINGS = 38;
      const RADIALS = 80;
      const ARC = 240;
      const maxPhi = Math.PI * 0.88; // how far around inside the tube we render

      // ── Flat surface: concentric rings ──
      for (let i = 0; i <= FLAT_RINGS; i++) {
        const t = i / FLAT_RINGS;
        const r = rimR + (outerR - rimR) * t;

        // Fade at far edges
        let alpha = 0.10;
        if (t > 0.65) {
          alpha = 0.10 * Math.max(0, 1 - (t - 0.65) / 0.35);
        }
        if (alpha < 0.005) continue;

        ctx.strokeStyle = `rgba(50, 50, 50, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let j = 0; j <= ARC; j++) {
          const theta = (j / ARC) * Math.PI * 2;
          const [x, y] = flatPt(r, theta);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // ── Tube surface: rings at each phi depth ──
      for (let i = 0; i <= TUBE_RINGS; i++) {
        const phi = (i / TUBE_RINGS) * maxPhi;
        const depth = phi / maxPhi; // 0 at rim → 1 at deepest

        // Lines get darker deeper inside the tube
        const alpha = 0.06 + 0.22 * depth;
        ctx.strokeStyle = `rgba(40, 40, 40, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 0.4 + 0.5 * depth;
        ctx.beginPath();
        for (let j = 0; j <= ARC; j++) {
          const theta = (j / ARC) * Math.PI * 2;
          const [x, y] = tubePt(phi, theta);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // ── Radial lines (flat surface → into tube) ──
      for (let j = 0; j < RADIALS; j++) {
        const theta = (j / RADIALS) * Math.PI * 2;

        ctx.strokeStyle = "rgba(50, 50, 50, 0.07)";
        ctx.lineWidth = 0.4;
        ctx.beginPath();

        // Flat part: from outer edge inward to rim
        let first = true;
        for (let i = FLAT_RINGS; i >= 0; i--) {
          const t = i / FLAT_RINGS;
          const r = rimR + (outerR - rimR) * t;
          const [x, y] = flatPt(r, theta);
          if (first) { ctx.moveTo(x, y); first = false; }
          else ctx.lineTo(x, y);
        }

        // Tube part: continue from rim into the tube
        for (let i = 0; i <= TUBE_RINGS; i++) {
          const phi = (i / TUBE_RINGS) * maxPhi;
          const [x, y] = tubePt(phi, theta);
          ctx.lineTo(x, y);
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
