import { describe, expect, it } from "vitest";
import { floorDepth, pxPerMetre, toScreen, toWorld, vanishing, type Cam3D } from "./camera3d.ts";

const W = 832, H = 1216;
const cam = (o: Partial<Cam3D> = {}): Cam3D => ({ x: 0, y: 1.5, z: 5, yaw: 0, pitch: 0, focal: 35, ...o });

describe("camera3d", () => {
  it("projects and unprojects the same point", () => {
    const c = cam({ yaw: 25, pitch: -12, x: 1, z: 3 });
    const p = toScreen(c, W, H, [0.4, 0.9, -2])!;
    const q = toWorld(c, W, H, p.x, p.y, p.d);
    expect(q[0]).toBeCloseTo(0.4, 6); expect(q[1]).toBeCloseTo(0.9, 6); expect(q[2]).toBeCloseTo(-2, 6);
  });
  it("finds the floor under a pixel below the horizon only", () => {
    const c = cam();
    expect(floorDepth(c, W, H, W / 2, H / 2 - 10)).toBeNull();
    const d = floorDepth(c, W, H, W / 2, H * 0.8)!;
    const p = toWorld(c, W, H, W / 2, H * 0.8, d);
    expect(p[1]).toBeCloseTo(0, 6);
  });
  it("a figure 1 m tall spans pxPerMetre pixels at its depth", () => {
    const c = cam(), base = toScreen(c, W, H, [0, 0, 0])!, top = toScreen(c, W, H, [0, 1, 0])!;
    expect(base.y - top.y).toBeCloseTo(pxPerMetre(c, W, H, base.d), 3);
  });
  it("looking straight ahead: one vanishing point at the centre, level and upright lines", () => {
    const v = vanishing(cam(), W, H);
    expect(v.vps.filter(Boolean)).toEqual([[0.5, 0.5]]);
    expect(v.dirs.map(a => Math.abs(Math.round(a)) % 180)).toEqual([0, 90]);
    expect(v.horizon).toBeCloseTo(0.5, 6);
  });
  it("turned and tilted down: three vanishing points, the vertical one below", () => {
    const v = vanishing(cam({ yaw: 30, pitch: -20 }), W, H);
    expect(v.vps.every(Boolean)).toBe(true);
    expect(v.vps[1]![1]).toBeGreaterThan(1);
    expect(v.vps[0]![1]).toBeCloseTo(v.vps[2]![1], 5);
    expect(v.horizon!).toBeCloseTo(v.vps[0]![1], 5);
  });
});
