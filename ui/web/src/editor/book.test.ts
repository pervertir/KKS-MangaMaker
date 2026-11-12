import { describe, expect, it } from "vitest";
import { inferFormat } from "../core/format.ts";
import type { Doc, Page } from "../types.ts";
import { applyFormat, guides, halves, nombres, normalizeBook, pageWidth, slotCount, slotLabel, spreadMisplaced } from "./book.ts";

const pg = (span?: 2): Page => ({ id: Math.random().toString(36), bg: "#fff", layers: [], ...(span ? { span } : {}) });
function book(spans: (2 | undefined)[], reading: "rtl" | "ltr" = "rtl"): Doc {
  const base = { width: 1800, height: 2700, reading };
  const doc = { version: 1, title: "t", ...base, maxFont: 56, format: inferFormat(base), pages: spans.map(pg) } as Doc;
  normalizeBook(doc);
  doc.numbering.show = true;
  return doc;
}

describe("book", () => {
  it("a spread is two pages wide without bleed at the fold and fills two slots", () => {
    const d = book([undefined, undefined, undefined, 2, undefined]);
    const b = 3 * d.width / 182;
    expect(pageWidth(d, d.pages[3])).toBeCloseTo(3600 - 2 * b, 1);
    expect(slotCount(d)).toBe(6);
    expect(slotLabel(d, 3)).toBe("4–5");
    expect(spreadMisplaced(d, 3)).toBe(false);
    expect(spreadMisplaced(book([undefined, undefined, 2]), 2)).toBe(true);
  });
  it("splits a manga spread right half first, each half a full page with its own bleed", () => {
    const d = book([undefined, 2]);
    const [first, second] = halves(d, 1);
    expect(first).toMatchObject({ slot: 2, side: "right" });
    expect(second).toMatchObject({ slot: 3, side: "left", rect: { x: 0, w: 1800 } });
    expect(first.rect.x + first.rect.w).toBeCloseTo(pageWidth(d, d.pages[1]), 5);
    const ltr = halves(book([undefined, 2], "ltr"), 1);
    expect(ltr[0]).toMatchObject({ slot: 2, side: "left", rect: { x: 0 } });
  });
  it("puts page numbers on the outer corner and skips covers", () => {
    const d = book([undefined, undefined, undefined]);
    d.pages[0].kind = "cover";
    expect(nombres(d, 0)).toEqual([]);
    expect(nombres(d, 1)[0]).toMatchObject({ text: "2", align: "right" });     // manga: slot 2 is a right-hand page
    expect(nombres(d, 2)[0]).toMatchObject({ text: "3", align: "left" });
  });
  it("draws the fold and the gutter band on a spread", () => {
    const d = book([undefined, 2]), G = guides(d, d.pages[1]);
    expect(G.fold).toBeCloseTo(pageWidth(d, d.pages[1]) / 2, 5);
    expect(G.safe).toHaveLength(2);
    expect(G.gutter[0].x + G.gutter[0].w / 2).toBeCloseTo(G.fold!, 5);
  });
  it("rescales the pages to a new format", () => {
    const d = book([undefined]);
    d.pages[0].layers.push({ id: "a", type: "panel", x: 900, y: 0, w: 900, h: 2700, rotate: 0, visible: true, locked: true, opacity: 1, blend: "source-over", border: 6 });
    expect(applyFormat(d, { ...d.format, trimW: 128, trimH: 182, dpi: 600 })).toBe(true);
    const l = d.pages[0].layers[0];
    expect(l.x + l.w).toBeCloseTo(d.width, 3);
    expect(l.h).toBeCloseTo(d.height, 3);
  });
});
