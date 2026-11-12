/* Small geometry and randomness helpers shared by the effects. Handles and eraser strokes are stored as
   fractions of the layer's box ([0..1, 0..1]), so moving or resizing the layer carries them along. */

export type Pt = [number, number];
export interface Box { x: number; y: number; w: number; h: number; rotate?: number }

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* smooth value noise in [0, 1], for cloud tones */
export function noise2(seed: number): (x: number, y: number) => number {
  const N = 64, r = rng(seed), g = Float32Array.from({ length: N * N }, r);
  const at = (i: number, j: number) => g[((j % N + N) % N) * N + ((i % N + N) % N)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = sm(x - i), fy = sm(y - j);
    return lerp(lerp(at(i, j), at(i + 1, j), fx), lerp(at(i, j + 1), at(i + 1, j + 1), fx), fy);
  };
}

/* page point <-> box fraction, honouring the layer's rotation about its centre */
export function toFrac(b: Box, p: Pt): Pt {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = -(b.rotate || 0) * Math.PI / 180;
  const dx = p[0] - cx, dy = p[1] - cy, c = Math.cos(a), s = Math.sin(a);
  return [(dx * c - dy * s) / b.w + 0.5, (dx * s + dy * c) / b.h + 0.5];
}
export function fromFrac(b: Box, f: Pt): Pt {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = (b.rotate || 0) * Math.PI / 180;
  const dx = (f[0] - 0.5) * b.w, dy = (f[1] - 0.5) * b.h, c = Math.cos(a), s = Math.sin(a);
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/* where a ray from c at angle a leaves a closed polygon (the farthest crossing), or null */
export function rayExit(c: Pt, a: number, poly: Pt[]): number | null {
  const dx = Math.cos(a), dy = Math.sin(a);
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((x1 - c[0]) * ey - (y1 - c[1]) * ex) / den, u = ((x1 - c[0]) * dy - (y1 - c[1]) * dx) / den;
    if (t >= 0 && u >= 0 && u <= 1 && (best == null || t > best)) best = t;
  }
  return best;
}
