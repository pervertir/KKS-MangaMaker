import { describe, expect, it } from "vitest";
import { coverage, gradT, migrateTone, pageDpi, stopsAt, BUILTIN } from "./tones.ts";
import { boundaryAt, migrateSpeed, type SpeedSpec } from "./speed.ts";
import { fromFrac, rayExit, toFrac } from "./geom.ts";

describe("tones", () => {
  it("uses the format's dpi, else a 182 mm page", () => {
    expect(pageDpi({ width: 1800 })).toBeCloseTo(251.2, 1);
    expect(pageDpi({ width: 1800, format: { dpi: 600 } })).toBe(600);
  });
  it("interpolates gradient stops in any order", () => {
    expect(stopsAt([[1, 0], [0, 80]], 0.5)).toBe(40);
    expect(stopsAt([[0, 10], [0.5, 50], [1, 10]], 0.75)).toBe(30);
    expect(stopsAt([[0.2, 30], [0.8, 60]], 0)).toBe(30);
  });
  it("projects linear and radial gradients", () => {
    const lin = { kind: "linear" as const, a: [0.5, 0] as [number, number], b: [0.5, 1] as [number, number], stops: [] };
    expect(gradT(lin, 50, 25, 100, 100)).toBeCloseTo(0.25);
    const rad = { ...lin, kind: "radial" as const, a: [0.5, 0.5] as [number, number], b: [1, 0.5] as [number, number] };
    expect(gradT(rad, 50, 75, 100, 100)).toBeCloseTo(0.5);
    const cov = coverage({ shape: "round", lpi: 60, pct: 50, angle: 45, grad: { ...lin, stops: [[0, 100], [1, 0]] } }, 100, 100);
    expect(cov(50, 0)).toBeCloseTo(1); expect(cov(50, 100)).toBeCloseTo(0);
  });
  it("turns v1 tones into v2 ones", () => {
    const l: Record<string, any> = { type: "tone", pattern: "dots", size: 10, density: 0.4, angle: 45, fade: "down" };
    migrateTone(l, 251.2);
    expect(l).toMatchObject({ shape: "round", lpi: 25.1, pct: 40, grad: { kind: "linear", stops: [[0, 40], [1, 0]] } });
    expect(l.pattern).toBeUndefined(); expect(l.fade).toBeUndefined();
  });
  it("ships a library of about 60 tones with unique ids", () => {
    expect(BUILTIN.length).toBeGreaterThanOrEqual(55);
    expect(new Set(BUILTIN.map(t => t.id)).size).toBe(BUILTIN.length);
  });
});

describe("speed lines", () => {
  const sp = (o: Partial<SpeedSpec> = {}): SpeedSpec => ({ mode: "focus", count: 10, thick: 4, inner: 0.5, jitter: 0, spread: 0, taper: 1, angle: 0, center: [0.5, 0.5], seed: 1, ...o });
  it("finds the empty-centre boundary on the ellipse", () => {
    expect(boundaryAt(sp(), 200, 100, 0)).toBeCloseTo(50);
    expect(boundaryAt(sp(), 200, 100, Math.PI / 2)).toBeCloseTo(25);
  });
  it("follows an edited centre shape", () => {
    const s = sp({ innerPts: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]] });
    expect(boundaryAt(s, 100, 100, 0)).toBeCloseTo(25);
    expect(rayExit([0, 0], 0, [[1, -1], [2, -1], [2, 1], [1, 1]])).toBeCloseTo(2);
  });
  it("fills v2 settings into v1 lines", () => {
    const l: Record<string, any> = { mode: "parallel", count: 50 };
    migrateSpeed(l);
    expect(l).toMatchObject({ count: 50, taper: 1, center: [0.5, 0.5], innerPts: null });
  });
});

describe("box fractions", () => {
  it("round-trip through a rotated box", () => {
    const b = { x: 10, y: 20, w: 200, h: 100, rotate: 30 };
    const p = fromFrac(b, [0.2, 0.9]), f = toFrac(b, p);
    expect(f[0]).toBeCloseTo(0.2); expect(f[1]).toBeCloseTo(0.9);
  });
});
