import { describe, expect, it } from "vitest";
import { cursorFor, hitHandle, rotateTo, scaleBox } from "../transform.ts";

const b = { x: 100, y: 100, w: 200, h: 100, rotate: 0 };
describe("transform box", () => {
  it("scales from the opposite edge", () => {
    expect(scaleBox(b, { hx: 1, hy: 0 }, [350, 999])).toEqual({ x: 100, y: 100, w: 250, h: 100, rotate: 0 });
    expect(scaleBox(b, { hx: -1, hy: -1 }, [50, 50])).toEqual({ x: 50, y: 50, w: 250, h: 150, rotate: 0 });
  });
  it("keeps aspect and scales from the centre", () => {
    const k = scaleBox(b, { hx: 1, hy: 1 }, [500, 210], { keepAspect: true });
    expect(k.w / k.h).toBeCloseTo(2);
    const c = scaleBox(b, { hx: 1, hy: 0 }, [450, 150], { fromCentre: true });
    expect(c.x + c.w / 2).toBeCloseTo(200); expect(c.w).toBeCloseTo(500);
  });
  it("respects rotation", () => {
    const r = { ...b, rotate: 90 };
    const s = scaleBox(r, { hx: 1, hy: 0 }, [200, 400]);
    expect(s.w).toBeCloseTo(350);
    expect(s.x + s.w / 2).toBeCloseTo(200); expect(s.y + s.h / 2).toBeCloseTo(225);
  });
  it("finds handles and rotation", () => {
    expect(hitHandle(b, [300, 150], 1)).toEqual({ kind: "scale", hx: 1, hy: 0 });
    expect(hitHandle(b, [200, 100 - 34], 1)).toEqual({ kind: "rotate" });
    expect(hitHandle(b, [200, 66], 1, { rotate: false })).toBeNull();
    expect(rotateTo(b, [300, 150])).toBe(90);
    expect(rotateTo(b, [300, 160], 15)).toBe(90);
    expect(cursorFor({ kind: "scale", hx: 1, hy: 0 })).toBe("ew-resize");
    expect(cursorFor({ kind: "scale", hx: 1, hy: 0 }, 90)).toBe("ns-resize");
  });
});
