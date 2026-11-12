import { describe, expect, it } from "vitest";
import { parseRuby, plainText, tokenize, units } from "../ruby.ts";
import { boxShape, fitLayout, layout } from "../layout.ts";
import { chord, nodesToPath, presetNodes, simplify, splitSegment, traceMask } from "../geom.ts";
import { length } from "../../core/geometry/path.ts";

const mono = (t: string, px: number) => [...t].length * px * 0.6;

describe("furigana markup", () => {
  it("reads braces, bar-and-brackets and bare brackets", () => {
    expect(parseRuby("{漢字|かんじ}だ")).toEqual([{ text: "漢字", ruby: "かんじ" }, { text: "だ" }]);
    expect(parseRuby("あの｜少年《しょうねん》")).toEqual([{ text: "あの" }, { text: "少年", ruby: "しょうねん" }]);
    expect(parseRuby("彼は東京《とうきょう》へ")).toEqual([{ text: "彼は" }, { text: "東京", ruby: "とうきょう" }, { text: "へ" }]);
    expect(plainText("{漢|かん}{字|じ}")).toBe("漢字");
  });
  it("leaves stray brackets as text", () => {
    expect(plainText("a{b} c《d》")).toBe("a{b} c《d》");
  });
});

describe("tokens", () => {
  it("sets short numbers and !? upright in vertical text, long Latin on its side", () => {
    const k = (s: string) => tokenize(s, true).map(t => `${t.t}:${t.k}`);
    expect(k("第12話!?")).toEqual(["第:cjk", "12:tcy", "話:cjk", "!?:tcy"]);
    expect(k("OK、Hello")).toEqual(["OK:tcy", "、:cjk", "Hello:latin"]);
    expect(tokenize("2024", false)[0].k).toBe("latin");
  });
  it("keeps a ruby group together", () => {
    const us = units("{漢字|かんじ}です", true);
    expect(us[0].toks.map(t => t.t).join("")).toBe("漢字");
    expect(us[0].ruby).toBe("かんじ");
    expect(us.length).toBe(3);
  });
});

describe("vertical layout", () => {
  it("breaks columns right to left and keeps 、。 off a column start", () => {
    const L = layout("あいうえ。かき", boxShape(400, 4 * 20 * 1.0 + 1), 20, { vertical: true }, mono);
    expect(L.lines.length).toBe(2);
    expect(L.lines[1].startsWith("。")).toBe(false);
    const xs = [...new Set(L.draws.filter(d => !d.ruby).map(d => Math.round(d.x)))];
    expect(xs[0]).toBeGreaterThan(xs[1]);        // first column is the right one
  });
  it("does not end a column on an opening bracket", () => {
    const L = layout("あいう「えお」", boxShape(400, 4 * 20 + 1), 20, { vertical: true }, mono);
    for (const c of L.lines) expect(c.endsWith("「")).toBe(false);
  });
  it("turns brackets and long marks, moves the full stop to the corner", () => {
    const L = layout("「ラー。」", boxShape(100, 400), 20, { vertical: true }, mono);
    const by = Object.fromEntries(L.draws.map(d => [d.t, d]));
    expect(by["「"].rot).toBe(true);
    expect(by["ー"].rot).toBe(true);
    expect(by["。"].corner).toBe(true);
    expect(by["ラ"].rot).toBeFalsy();
  });
  it("puts furigana to the right of the column at half size", () => {
    const L = layout("{漢字|かんじ}", boxShape(200, 400), 20, { vertical: true }, mono);
    const base = L.draws.filter(d => !d.ruby), ruby = L.draws.filter(d => d.ruby);
    expect(ruby.length).toBe(3);
    expect(ruby[0].px).toBe(10);
    expect(ruby[0].x).toBeGreaterThan(base[0].x);
  });
  it("fits the largest size that fits", () => {
    const L = fitLayout("あいうえおかきくけこ", boxShape(100, 100), 80, 0, { vertical: true }, mono);
    expect(L.ok).toBe(true);
    const bigger = layout("あいうえおかきくけこ", boxShape(100, 100), L.px + 1, { vertical: true }, mono);
    expect(bigger.ok).toBe(false);
  });
});

describe("horizontal layout", () => {
  it("wraps Japanese without spaces and English at spaces", () => {
    const ja = layout("こんにちは世界", boxShape(20 * 0.6 * 4 + 1, 400), 20, { vertical: false }, mono);
    expect(ja.lines.length).toBe(2);
    const en = layout("hello there you", boxShape(12 * 6 + 1, 400), 20, { vertical: false }, mono);
    expect(en.lines).toEqual(["hello", "there", "you"]);
  });
  it("puts furigana above the base", () => {
    const L = layout("{漢字|かんじ}", boxShape(400, 400), 20, { vertical: false }, mono);
    const ruby = L.draws.find(d => d.ruby)!, base = L.draws.find(d => !d.ruby)!;
    expect(ruby.y).toBeLessThan(base.y);
  });
});

describe("balloon geometry", () => {
  it("presets close into a path", () => {
    for (const k of ["oval", "box", "cloud", "burst", "flash", "wavy", "rect"]) {
      const p = nodesToPath(presetNodes(k, 400, 300, 3), 400, 300);
      expect(p.subs[0].closed).toBe(true);
      const last = p.subs[0].segs[p.subs[0].segs.length - 1].p;
      expect(last).toEqual(p.subs[0].start);
      expect(length(p)).toBeGreaterThan(700);
    }
  });
  it("splitting a segment keeps the curve", () => {
    const n = presetNodes("oval", 1, 1), m = splitSegment(n, 0, 0.5);
    expect(m.length).toBe(n.length + 1);
    expect(Math.hypot(m[1].x, m[1].y)).toBeCloseTo(0.5, 2);
  });
  it("finds the inside chord of a polygon", () => {
    const sq: [number, number][] = [[-50, -50], [50, -50], [50, 50], [-50, 50]];
    expect(chord(sq, 0, 0, true)).toEqual([-50, 50]);
    expect(chord(sq, 80, 0, true)).toBeNull();
  });
  it("traces a filled disc", () => {
    const W = 60, H = 40, mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x - 30) / 25) ** 2 + ((y - 20) / 15) ** 2 <= 1) mask[y * W + x] = 1;
    mask[0] = 1;                                   // a speck that is not the bubble
    const poly = traceMask(mask, W, H), s = simplify(poly, 0.6);
    expect(poly.length).toBeGreaterThan(80);
    expect(s.length).toBeLessThan(poly.length);
    const xs = poly.map(p => p[0]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...xs)).toBeLessThanOrEqual(56);
  });
});
