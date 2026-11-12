import { describe, expect, it } from "vitest";
import { boxOutline, defineLayerType, layerType, outlineOf, provideOutline } from "../registry.ts";
import { area, bounds, rect } from "../geometry/region.ts";
import type { Layer } from "../../types.ts";

const base = { x: 0, y: 0, w: 100, h: 50, rotate: 0, visible: true, locked: false, opacity: 1, blend: "source-over" };

describe("layer registry", () => {
  it("registers a type and uses its defaults and outline", () => {
    defineLayerType<Layer>({ type: "dot", label: "Dot", defaults: l => { l.r ??= 5; }, draw: () => {}, outline: l => rect(l.x, l.y, 1, 1) });
    const l = { ...base, id: "a", type: "dot" } as Layer;
    layerType("dot")!.defaults!(l);
    expect(l.r).toBe(5);
    expect(area(outlineOf(l))).toBeCloseTo(1);
  });
  it("rotates the default box outline about its centre", () => {
    const b = bounds(boxOutline({ ...base, rotate: 90 }))!;
    expect(b.w).toBeCloseTo(50, 6); expect(b.h).toBeCloseTo(100, 6);
    expect(b.x).toBeCloseTo(25, 6);
  });
  it("lets a module supply outlines for built-in types", () => {
    provideOutline(l => l.type === "panel" && l.shape ? rect(0, 0, 10, 10) : null);
    expect(area(outlineOf({ ...base, id: "p", type: "panel", shape: "poly" } as Layer))).toBeCloseTo(100);
    expect(area(outlineOf({ ...base, id: "q", type: "panel" } as Layer))).toBeCloseTo(5000);
  });
});
