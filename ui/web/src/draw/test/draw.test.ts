import { describe, expect, it } from "vitest";
import { regionAt } from "../fill.ts";
import { decode, encode, eraseAt, type Item, type Pt, type StrokeItem } from "../vector.ts";
import type { Layer } from "../../types.ts";

const style = { color: "#000", size: 4, thinning: 0, smoothing: 0.5, streamline: 0.5, taper: [5, 5] as [number, number], pen: true };
const line = (pts: Pt[]): StrokeItem => ({ k: "s", pts: encode(pts), ...style });
const layer = (items: Item[]): Layer => ({ id: "v", type: "vector", x: 0, y: 0, w: 200, h: 200, ow: 200, oh: 200, rotate: 0, visible: true, locked: false, opacity: 1, blend: "source-over", items });
const strokes = (l: Layer) => (l.items as StrokeItem[]).map(s => decode(s.pts));

describe("points", () => {
  it("round-trip through the compact string", () => {
    expect(decode(encode([[1.23, 4.56, 0.789], [10, 20, 1]]))).toEqual([[1.2, 4.6, 0.79], [10, 20, 1]]);
  });
});

describe("vector eraser", () => {
  const horiz = () => line([[0, 100, 1], [200, 100, 1]]);
  const cuts = () => [line([[50, 0, 1], [50, 200, 1]]), line([[150, 0, 1], [150, 200, 1]])];

  it("whole line: removes only the touched line", () => {
    const l = layer([horiz(), ...cuts()]);
    expect(eraseAt(l, 100, 101, 3, "stroke")).toBe(true);
    expect(l.items).toHaveLength(2);
    expect(eraseAt(l, 100, 120, 3, "stroke")).toBe(false);
  });
  it("to crossing: cuts out the part between the two crossing lines", () => {
    const l = layer([horiz(), ...cuts()]);
    eraseAt(l, 100, 100, 3, "intersect");
    const parts = strokes(l).filter(p => p[0][1] === 100);
    expect(parts).toHaveLength(2);
    expect(parts[0][parts[0].length - 1][0]).toBeCloseTo(50, 3);
    expect(parts[1][0][0]).toBeCloseTo(150, 3);
  });
  it("to crossing: with no crossing the whole line goes", () => {
    const l = layer([horiz()]);
    eraseAt(l, 100, 100, 3, "intersect");
    expect(l.items).toHaveLength(0);
  });
  it("partial: splits the line where the eraser passed and keeps the outer tapers", () => {
    const l = layer([horiz()]);
    eraseAt(l, 100, 100, 10, "partial");
    const ps = l.items as StrokeItem[];
    expect(ps).toHaveLength(2);
    const [a, b] = ps.map(s => decode(s.pts));
    expect(a[a.length - 1][0]).toBeLessThan(90);
    expect(b[0][0]).toBeGreaterThan(110);
    expect(ps[0].taper).toEqual([5, 0]);
    expect(ps[1].taper).toEqual([0, 5]);
  });
});

describe("fill region", () => {
  /* a 40x40 white image with a black ring (outer 30, inner 26) centred, broken by a 2 px gap */
  function ring(gap: boolean) {
    const w = 40, h = 40, d = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const r = Math.hypot(x - 20, y - 20);
      if (r <= 15 && r >= 13 && !(gap && y >= 19 && y <= 20 && x > 30)) { const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = 0; }
    }
    return { width: w, height: h, data: d, colorSpace: "srgb" } as ImageData;
  }
  const area = (r: number[][][]) => Math.abs(r.reduce((s, g) => s + g.reduce((a, p, i) => { const q = g[(i + 1) % g.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2, 0));

  it("fills inside a closed ring, tucked under the line", () => {
    const r = regionAt(ring(false), 1, 20, 20, 0, 48);
    expect(area(r)).toBeGreaterThan(Math.PI * 13 * 13 * 0.9);
    expect(area(r)).toBeLessThan(Math.PI * 15 * 15);
  });
  it("leaks through a gap unless gap closing is on", () => {
    expect(area(regionAt(ring(true), 1, 20, 20, 0, 48))).toBeGreaterThan(1000);
    expect(area(regionAt(ring(true), 1, 20, 20, 3, 48))).toBeLessThan(Math.PI * 15 * 15);
  });
  it("scales the region back to page px", () => {
    const r = regionAt(ring(false), 0.5, 40, 40, 0, 48);
    expect(Math.max(...r.flat().map(p => p[0]))).toBeGreaterThan(50);
  });
});
