import type { Region, Ring } from "./geometry/region.ts";

/** A 0/1 mask, one byte per pixel, row major. */
export interface Mask { w: number; h: number; data: Uint8Array }

/** Pixels connected to (x, y) whose colour is within `tol` (0..255, per channel) of the seed. 4-connected. */
export function floodMask(img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, x: number, y: number, tol: number, contiguous = true): Mask {
  const { width: w, height: h, data } = img, out = new Uint8Array(w * h);
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return { w, h, data: out };
  const i0 = (y * w + x) * 4, r = data[i0], g = data[i0 + 1], b = data[i0 + 2], a = data[i0 + 3];
  const near = (i: number) => { const j = i * 4; return Math.abs(data[j] - r) <= tol && Math.abs(data[j + 1] - g) <= tol && Math.abs(data[j + 2] - b) <= tol && Math.abs(data[j + 3] - a) <= tol; };
  if (!contiguous) { for (let i = 0; i < w * h; i++) if (near(i)) out[i] = 1; return { w, h, data: out }; }
  const stack = [y * w + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (out[i] || !near(i)) continue;
    let lo = i, hi = i;
    const row = i - (i % w);
    while (lo > row && !out[lo - 1] && near(lo - 1)) lo--;
    while (hi < row + w - 1 && !out[hi + 1] && near(hi + 1)) hi++;
    for (let k = lo; k <= hi; k++) {
      out[k] = 1;
      if (k >= w && !out[k - w]) stack.push(k - w);
      if (k < w * (h - 1) && !out[k + w]) stack.push(k + w);
    }
  }
  return { w, h, data: out };
}

/** Grows (n > 0) a mask by n pixels, used to close small gaps before a fill. */
export function dilate(m: Mask, n: number): Mask {
  let cur = m.data;
  for (let s = 0; s < n; s++) {
    const nx = new Uint8Array(cur);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x; if (cur[i]) continue;
      if ((x > 0 && cur[i - 1]) || (x < m.w - 1 && cur[i + 1]) || (y > 0 && cur[i - m.w]) || (y < m.h - 1 && cur[i + m.w])) nx[i] = 1;
    }
    cur = nx;
  }
  return { w: m.w, h: m.h, data: cur };
}

/** Outlines of the set pixels as closed rings along pixel edges (holes included; fill even-odd), scaled by `scale`
 *  and offset by (ox, oy), with straight runs merged. */
export function maskToRegion(m: Mask, scale = 1, ox = 0, oy = 0): Region {
  const { w, h, data } = m, W1 = w + 1;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
  // directed edges with the inside on the right; keyed by start vertex
  const next = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = y0 * W1 + x0, v = y1 * W1 + x1, l = next.get(k);
    if (l) l.push(v); else next.set(k, [v]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y);
    if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) add(x, y + 1, x, y);
  }
  const rings: Region = [];
  for (const [start] of next) {
    while (next.get(start)?.length) {
      const verts: number[] = [start];
      let k = start;
      for (;;) {
        const l = next.get(k)!; const v = l.pop()!; if (!l.length) next.delete(k);
        if (v === start) break;
        verts.push(v); k = v;
        if (!next.get(k)?.length) break;
      }
      const ring: Ring = [];
      for (let i = 0; i < verts.length; i++) {
        const p = verts[(i + verts.length - 1) % verts.length], c = verts[i], n = verts[(i + 1) % verts.length];
        const px = p % W1, py = (p / W1) | 0, cx = c % W1, cy = (c / W1) | 0, nx = n % W1, ny = (n / W1) | 0;
        if ((cx - px) * (ny - cy) - (cy - py) * (nx - cx) === 0) continue;
        ring.push([ox + cx * scale, oy + cy * scale]);
      }
      if (ring.length > 2) rings.push(ring);
    }
  }
  return rings;
}
