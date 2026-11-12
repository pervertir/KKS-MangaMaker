import { describe, expect, it } from "vitest";
import * as N from "../node-editor.ts";
import { line, length, type Path } from "../geometry/path.ts";
import { addSnapSource, axisSource, angleSource, snapPoint } from "../snap.ts";

const sq = () => line([[0, 0], [100, 0], [100, 100], [0, 100]], true);
const closedExplicit = (): Path => ({ subs: [{ start: [0, 0], segs: [{ p: [100, 0] }, { p: [100, 100] }, { p: [0, 0] }], closed: true }] });

describe("node editor", () => {
  it("lists and hits anchors", () => {
    expect(N.nodes(sq()).length).toBe(4);
    expect(N.hitNode(sq(), 99, 2, 5)).toEqual({ sub: 0, anchor: 1, part: "anchor" });
    expect(N.anchorCount(closedExplicit(), 0)).toBe(3);
  });
  it("moves an anchor and keeps an explicit closing point with the start", () => {
    const p = N.moveNode(closedExplicit(), { sub: 0, anchor: 0, part: "anchor" }, [10, 10]);
    expect(p.subs[0].start).toEqual([10, 10]);
    expect(p.subs[0].segs[2].p).toEqual([10, 10]);
  });
  it("inserts, smooths, mirrors handles and deletes", () => {
    const ins = N.insertNode(sq(), 50, 1, 5)!;
    expect(ins.ref.anchor).toBe(1);
    expect(N.anchorCount(ins.path, 0)).toBe(5);
    const sm = N.toggleSmooth(ins.path, ins.ref);
    const out = N.handleAt(sm, { ...ins.ref, part: "out" })!, inn = N.handleAt(sm, { ...ins.ref, part: "in" })!;
    expect(out[1]).toBeCloseTo(0); expect(inn[0]).toBeLessThan(50); expect(out[0]).toBeGreaterThan(50);
    const moved = N.moveNode(sm, { ...ins.ref, part: "out" }, [60, 10]);
    const mi = N.handleAt(moved, { ...ins.ref, part: "in" })!;
    expect(Math.atan2(mi[1] - 0, mi[0] - 50)).toBeCloseTo(Math.atan2(-10, -10));
    const del = N.deleteNode(moved, ins.ref);
    expect(N.anchorCount(del, 0)).toBe(4);
    expect(length(del)).toBeCloseTo(400, 0);
  });
  it("maps a layer-local frame", () => {
    const f = N.boxFrame({ x: 0, y: 0, w: 100, h: 50, rotate: 90 });
    const p = f.toPage([10, 0]);
    expect(p[0]).toBeCloseTo(50); expect(p[1]).toBeCloseTo(35);
    const back = f.toLocal(p); expect(back[0]).toBeCloseTo(10); expect(back[1]).toBeCloseTo(0);
  });
});

describe("snapping", () => {
  it("prefers higher priority sources and draws guides", () => {
    const off1 = addSnapSource(axisSource("edges", 1, () => ({ xs: [100], ys: [50] })));
    expect(snapPoint([97, 10], { threshold: 5 })).toMatchObject({ pt: [100, 10], guide: { x: 100 } });
    expect(snapPoint([97, 48], { threshold: 5 }).guide).toEqual({ point: [100, 50] });
    const off2 = addSnapSource(axisSource("ruler", 10, () => ({ xs: [94], ys: [] })));
    expect(snapPoint([97, 10], { threshold: 5 }).pt).toEqual([94, 10]);
    off2(); off1();
    expect(snapPoint([97, 10], { threshold: 5 }).pt).toEqual([97, 10]);
  });
  it("snaps line direction to angle steps", () => {
    const off = addSnapSource(angleSource("angle", 5, 15, () => true));
    const h = snapPoint([100, 3], { threshold: 2, from: [0, 0] });
    expect(h.pt[1]).toBeCloseTo(0); expect(h.pt[0]).toBeCloseTo(Math.hypot(100, 3));
    off();
  });
});
