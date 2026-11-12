import { describe, expect, it } from "vitest";
import { boxes, canvasSize, inferFormat, mmToPx } from "../format.ts";

describe("book format", () => {
  it("infers a v1 format that puts trim and safe exactly where the old guides were", () => {
    const f = inferFormat({ width: 1800, height: 2700, reading: "rtl" });
    const mm = 1800 / 182;
    const b = boxes(f, 1800, 2700);
    expect(b.trim.x).toBeCloseTo(3 * mm, 6);
    expect(b.safe.x).toBeCloseTo(8 * mm, 6);
    expect(b.trim.h).toBeCloseTo(2700 - 6 * mm, 6);
    expect(f.dpi).toBeCloseTo(251.2088, 3);
    const c = canvasSize(f);
    expect(c.w).toBe(1800);
    expect(c.h).toBe(2700);
  });
  it("sizes a B5 page at 600 dpi and a spread", () => {
    const f = { trimW: 182, trimH: 257, bleed: 3, safe: 5, dpi: 600, binding: "rtl" as const, colour: "mono" as const };
    expect(canvasSize(f)).toEqual({ w: Math.round(mmToPx(f, 188)), h: Math.round(mmToPx(f, 263)) });
    expect(canvasSize(f, 2).w).toBe(Math.round(mmToPx(f, 370)));
  });
});
