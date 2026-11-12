import { describe, expect, it } from "vitest";
import { apply, diff } from "../patches.ts";
import * as H from "../history.ts";

const doc = () => ({ title: "a", pages: [{ id: "p1", layers: [{ id: "l1", x: 1, tags: [1, 2] }, { id: "l2", x: 2 }] }] });

describe("patches", () => {
  it("diffs id arrays by id and round-trips", () => {
    const a = doc(), b = structuredClone(a);
    b.pages[0].layers[1].x = 5; (b.pages[0].layers[0] as any).name = "n";
    const p = diff(a, b);
    expect(p).toEqual([{ op: "add", path: ["pages", 0, "layers", 0, "name"], value: "n" }, { op: "replace", path: ["pages", 0, "layers", 1, "x"], value: 5 }]);
    expect(apply(structuredClone(a), p)).toEqual(b);
    expect(apply(structuredClone(b), diff(b, a))).toEqual(a);
  });
  it("replaces reordered layer lists whole", () => {
    const a = doc(), b = structuredClone(a); b.pages[0].layers.reverse();
    expect(diff(a, b)).toHaveLength(1);
    expect(apply(structuredClone(a), diff(a, b))).toEqual(b);
  });
  it("round-trips random edits", () => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 200; n++) {
      const a: any = { pages: Array.from({ length: 3 }, (_, i) => ({ id: "p" + i, layers: Array.from({ length: 4 }, (_, j) => ({ id: `l${i}${j}`, x: j, o: { k: [j] } })) })) };
      const b = structuredClone(a);
      const L = b.pages[Math.floor(rnd() * 3)].layers;
      const r = rnd();
      if (r < 0.25) L.splice(Math.floor(rnd() * L.length), 1);
      else if (r < 0.5) L.push({ id: "new" + n, x: 9 });
      else if (r < 0.75) L[0].o.k.push(rnd());
      else delete L[1].x;
      expect(apply(structuredClone(a), diff(a, b))).toEqual(b);
      expect(apply(structuredClone(b), diff(b, a))).toEqual(a);
    }
  });
});

describe("history", () => {
  it("undoes and redoes commits, custom steps and page changes", () => {
    const h = H.createHistory<any>();
    let d: any = doc(); H.reset(h, d, 0);
    d.pages[0].layers[0].x = 10; H.commit(h, d, 0, "move");
    const pixels = { v: 1 };
    pixels.v = 2; d.pages[0].layers[1].bounds = 3;
    H.commit(h, d, 0, "paint", { bytes: 100, undo: () => { pixels.v = 1; }, redo: () => { pixels.v = 2; } });
    expect(H.commit(h, d, 0, "noop")).toBeNull();
    let r = H.undo(h, d)!; d = r.doc;
    expect(pixels.v).toBe(1); expect(d.pages[0].layers[1].bounds).toBeUndefined();
    r = H.undo(h, d)!; d = r.doc;
    expect(d).toEqual(doc());
    r = H.redo(h, d)!; d = r.doc; r = H.redo(h, d)!; d = r.doc;
    expect(d.pages[0].layers[0].x).toBe(10); expect(pixels.v).toBe(2);
  });
  it("lets the caller bump revisions on touched layers", () => {
    const h = H.createHistory<any>();
    const d: any = doc(); H.reset(h, d, 0);
    d.pages[0].layers[1].x = 7;
    H.commit(h, d, 0, "m", undefined, paths => { for (const p of paths) if (p[2] === "layers" && typeof p[3] === "number") d.pages[p[1]].layers[p[3]].rev = (d.pages[p[1]].layers[p[3]].rev || 0) + 1; });
    expect(d.pages[0].layers[1].rev).toBe(1);
    const back = H.undo(h, d)!.doc;
    expect(back.pages[0].layers[1].rev).toBeUndefined();
  });
  it("drops the oldest steps over the memory budget", () => {
    const h = H.createHistory<any>(), d: any = doc(); H.reset(h, d, 0);
    const old = H.LIMITS.bytes; H.LIMITS.bytes = 1e9;
    let disposed = 0;
    const step = () => H.commit(h, d, 0, "s", { bytes: 100, undo() {}, redo() {}, dispose: () => disposed++ })!;
    d.title = "x0"; const one = step().bytes;
    H.LIMITS.bytes = one * 2.5;
    for (let i = 1; i < 5; i++) { d.title = "x" + i; step(); }
    H.LIMITS.bytes = old;
    expect(h.undo.length).toBe(2); expect(disposed).toBe(3);
  });
});
