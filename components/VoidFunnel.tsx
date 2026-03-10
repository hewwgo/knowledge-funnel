"use client";

import { useEffect, useRef } from "react";
import { Renderer, Program, Mesh, Triangle, Texture } from "ogl";

const vertexShader = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `#version 300 es
precision mediump float;
precision mediump int;

out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform float uIntensity;
uniform float uSpeed;
uniform vec2  uOffset;
uniform sampler2D uGradient;
uniform int   uColorCount;
uniform float uDistort;

float hash21(vec2 p){
    p = floor(p);
    float f = 52.9829189 * fract(dot(p, vec2(0.065, 0.005)));
    return fract(f);
}

mat2 rot30(){ return mat2(0.8, -0.5, 0.5, 0.8); }

float layeredNoise(vec2 fragPx){
    vec2 p = mod(fragPx + vec2(uTime * 25.0, -uTime * 18.0), 1024.0);
    vec2 q = rot30() * p;
    float n = 0.0;
    n += 0.50 * hash21(q);
    n += 0.30 * hash21(q * 2.0 + 17.0);
    n += 0.20 * hash21(q * 4.0 + 47.0);
    return n;
}

vec3 rayDir(vec2 frag, vec2 res, vec2 offset, float dist){
    float focal = res.y * max(dist, 1e-3);
    return normalize(vec3(2.0 * (frag - offset) - res, focal));
}

mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,-s, 0.0,s,c); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.0,s, 0.0,1.0,0.0, -s,0.0,c); }
mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c,-s,0.0, s,c,0.0, 0.0,0.0,1.0); }

vec3 sampleGradient(float t){
    return texture(uGradient, vec2(clamp(t, 0.0, 1.0), 0.5)).rgb;
}

vec2 rot2(vec2 v, float a){
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c) * v;
}

float bendAngle(vec3 q, float t){
    return 0.7 * sin(q.x * 0.5 + t * 0.5)
         + 0.5 * sin(q.z * 0.55 + t * 0.6);
}

void main(){
    vec2 frag = gl_FragCoord.xy;
    float t = uTime * uSpeed;
    vec3 dir = rayDir(frag, uResolution, uOffset, 1.0);
    float marchT = 0.0;
    vec3 col = vec3(0.0);
    float n = layeredNoise(frag);

    vec3 ang = vec3(t * 0.25, t * 0.17, t * 0.13);
    mat3 rot3dMat = rotZ(ang.z) * rotY(ang.y) * rotX(ang.x);

    float amp = clamp(uDistort, 0.0, 50.0) * 0.12;

    for (int i = 0; i < 24; ++i) {
        vec3 P = marchT * dir;
        P.z -= 2.5;
        float rad = length(P);
        vec3 Pl = rot3dMat * (P * (8.0 / max(rad, 1e-6)));

        float stepLen = min(rad - 0.3, n * 0.01) + 0.18;

        float grow = smoothstep(0.3, 4.0, marchT);
        float a1 = amp * grow * bendAngle(Pl * 0.5, t);
        vec3 Pb = Pl;
        Pb.xz = rot2(Pb.xz, a1);

        // Smoother pattern — less sharp shards
        float pattern = sin(Pb.x + cos(Pb.y) * cos(Pb.z)) *
                        sin(Pb.z + sin(Pb.y) * cos(Pb.x + t));
        float rayPattern = smoothstep(0.3, 0.8, pattern);

        float saw = fract(marchT * 0.2);
        float tRay = saw * saw * (3.0 - 2.0 * saw);
        vec3 spectral = 2.0 * sampleGradient(tRay);

        // Center is black (the abyss), light emerges from mid-range, fades at edges
        float radFade = smoothstep(0.3, 2.5, rad) / (1.0 + rad * rad * 0.06);

        vec3 base = (0.04 / (0.5 + stepLen))
                  * radFade
                  * spectral;

        col += base * rayPattern;
        marchT += stepLen;
    }

    col *= uIntensity;

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const hexToRgb01 = (hex: string): [number, number, number] => {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const intVal = parseInt(h, 16);
  if (isNaN(intVal)) return [1, 1, 1];
  return [
    ((intVal >> 16) & 255) / 255,
    ((intVal >> 8) & 255) / 255,
    (intVal & 255) / 255,
  ];
};

export default function VoidFunnel() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // DPR 1.5 for smoother rendering without full retina cost
    const renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio || 1, 1.5), alpha: false, antialias: false });
    const gl = renderer.gl;

    gl.canvas.style.position = "absolute";
    gl.canvas.style.inset = "0";
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";
    container.appendChild(gl.canvas as HTMLCanvasElement);

    // Very dark deep tones — void/abyss feel
    const colors = ["#111a22", "#0c1218", "#111a22"];
    const colorCount = colors.length;
    const data = new Uint8Array(colorCount * 4);
    for (let i = 0; i < colorCount; i++) {
      const [r, g, b] = hexToRgb01(colors[i]);
      data[i * 4 + 0] = Math.round(r * 255);
      data[i * 4 + 1] = Math.round(g * 255);
      data[i * 4 + 2] = Math.round(b * 255);
      data[i * 4 + 3] = 255;
    }

    const gradientTex = new Texture(gl, {
      image: data,
      width: colorCount,
      height: 1,
      generateMipmaps: false,
      flipY: false,
    });

    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uResolution: { value: [1, 1] },
        uTime: { value: 0 },
        uIntensity: { value: 3.0 },
        uSpeed: { value: 0.15 },
        uOffset: { value: [0, 0] },
        uGradient: { value: gradientTex },
        uColorCount: { value: colorCount },
        uDistort: { value: 4.0 },
      },
    });

    const triangle = new Triangle(gl);
    const mesh = new Mesh(gl, { geometry: triangle, program });

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      program.uniforms.uResolution.value = [
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
      ];
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    let raf = 0;
    let last = performance.now();
    let accumTime = 0;

    const update = (now: number) => {
      const dt = Math.max(0, now - last) * 0.001;
      last = now;
      accumTime += dt;
      program.uniforms.uTime.value = accumTime;
      renderer.render({ scene: mesh });
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      try {
        container.removeChild(gl.canvas as HTMLCanvasElement);
      } catch { /* already removed */ }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
