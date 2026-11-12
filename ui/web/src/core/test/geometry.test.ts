import { describe, expect, it } from "vitest";
import * as R from "../geometry/region.ts";
import * as P from "../geometry/path.ts";

describe("region", () => {
  const a = R.rect(0, 0, 100, 100), b = R.rect(50, 0, 100, 100);
  it("does boolean ops", () => {
    expect(R.area(R.union(a, b))).toBeCloseTo(15000, 0);
    expect(R.area(R.intersect(a, b))).toBeCloseTo(5000, 0);
    expect(R.area(R.subtract(a, b))).toBeCloseTo(5000, 0);
    expect(R.area(R.exclude(a, b))).toBeCloseTo(10000, 0);
  });
  it("combines selections by mode", () => {
    expect(R.area(R.combine(a, b, "add"))).toBeCloseTo(15000, 0);
    expect(R.area(R.combine(a, b, "replace"))).toBeCloseTo(10000, 0);
  });
  it("treats an inner ring as a hole", () => {
    const ring = R.subtract(R.rect(0, 0, 100, 100), R.rect(25, 25, 50, 50));
    expect(R.contains(ring, 10, 10)).toBe(true);
    expect(R.contains(ring, 50, 50)).toBe(false);
    expect(R.area(ring)).toBeCloseTo(7500, 0);
  });
  it("offsets", () => {
    expect(R.area(R.offset(a, -10))).toBeCloseTo(6400, 0);
    const grown = R.bounds(R.offset(a, 10, "miter"))!;
    expect(grown.w).toBeCloseTo(120, 1);
  });
  it("strokes a line into a region", () => {
    expect(R.area(R.strokeLine([[0, 0], [100, 0]], 10, false))).toBeCloseTo(1000, 0);
  });
  it("writes svg", () => expect(R.toSvg(R.rect(0, 0, 1, 1))).toBe("M0 0L1 0L1 1L0 1Z"));
});

describe("path", () => {
  const sq = P.line([[0, 0], [100, 0], [100, 100], [0, 100]], true);
  it("measures and walks", () => {
    expect(P.length(sq)).toBeCloseTo(400, 6);
    const at = P.pointAt(sq, 150)!;
    expect(at.p).toEqual([100, 50]);
    expect(at.t).toEqual([0, 1]);
  });
  it("finds the nearest point and splits there", () => {
    const n = P.nearest(sq, 50, -5)!;
    expect(n.seg).toBe(0); expect(n.t).toBeCloseTo(0.5, 6);
    const s = P.splitAt(sq, 0, n.seg, n.t);
    expect(s.subs[0].segs.length).toBe(4);
    expect(s.subs[0].segs[0].p).toEqual([50, 0]);
    expect(P.length(s)).toBeCloseTo(400, 6);
  });
  it("flattens curves within tolerance", () => {
    const c: P.Path = { subs: [{ start: [0, 0], segs: [{ c1: [0, 55.2285], c2: [44.7715, 100], p: [100, 100] }], closed: false }] };
    const f = P.flatten(c, 0.25)[0].pts;
    expect(f.length).toBeGreaterThan(8);
    expect(f[f.length - 1]).toEqual([100, 100]);
  });
  it("converts closed paths to regions", () => expect(R.area(P.toRegion(sq))).toBeCloseTo(10000, 0));
  it("fits a smooth closed curve through points", () => {
    const sm = P.smoothThrough([[0, 0], [100, 0], [100, 100], [0, 100]], true);
    expect(sm.subs[0].segs.length).toBe(4);
    expect(P.toSvg(sm).startsWith("M0 0C")).toBe(true);
  });
});
