import { describe, expect, it } from "vitest";
import { floodMask, maskToRegion, dilate } from "../raster.ts";
import { area, contains } from "../geometry/region.ts";

function img(w: number, h: number, black: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = black(x, y) ? 0 : 255, i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  return { width: w, height: h, data };
}

describe("raster", () => {
  const ring = img(20, 20, (x, y) => (x === 4 || x === 15) && y >= 4 && y <= 15 || (y === 4 || y === 15) && x >= 4 && x <= 15);
  it("floods inside a closed outline only", () => {
    const m = floodMask(ring, 10, 10, 10);
    expect(m.data.reduce((a, b) => a + b, 0)).toBe(100);
    const r = maskToRegion(m);
    expect(r).toHaveLength(1);
    expect(r[0]).toHaveLength(4);
    expect(area(r)).toBe(100);
  });
  it("traces holes so even-odd fill leaves them out", () => {
    const m = floodMask(ring, 0, 0, 10);
    const r = maskToRegion(m, 2);
    expect(r).toHaveLength(2);
    expect(contains(r, 2, 2)).toBe(true);
    expect(contains(r, 20, 20)).toBe(false);
    expect(area(r)).toBe((400 - 144) * 4);
  });
  it("closes gaps by dilating the line art", () => {
    const gap = img(20, 20, (x, y) => ((x === 4 || x === 15) && y >= 4 && y <= 15 || (y === 4 || y === 15) && x >= 4 && x <= 15) && !(y === 4 && x === 10));
    const lines = floodMask(gap, 4, 4, 10);
    expect(floodMask(gap, 10, 10, 10).data.reduce((a, b) => a + b, 0)).toBeGreaterThan(100);
    expect(dilate(lines, 1).data[4 * 20 + 10]).toBe(1);
  });
});
