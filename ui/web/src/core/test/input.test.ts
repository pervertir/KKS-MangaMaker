import { describe, expect, it } from "vitest";
import { pressureCurve, stabilizer, type Sample } from "../input.ts";

const s = (x: number, y: number): Sample => ({ x, y, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0, t: 0, pointerType: "pen" });

describe("input", () => {
  it("rope stabilizer holds back until the pen pulls the rope tight", () => {
    const st = stabilizer({ kind: "rope", length: 10 });
    expect(st.push(s(0, 0))).toHaveLength(1);
    expect(st.push(s(5, 0))).toHaveLength(0);
    const out = st.push(s(20, 0));
    expect(out[0].x).toBeCloseTo(10, 6);
    expect(st.flush()[0].x).toBe(20);
  });
  it("average stabilizer smooths", () => {
    const st = stabilizer({ kind: "average", window: 2 });
    st.push(s(0, 0));
    expect(st.push(s(10, 0))[0].x).toBe(5);
  });
  it("pressure curve interpolates", () => {
    const f = pressureCurve([[0.5, 0.25]]);
    expect(f(0.5)).toBeCloseTo(0.25);
    expect(f(0.75)).toBeCloseTo(0.625);
    expect(f(2)).toBe(1);
  });
});
