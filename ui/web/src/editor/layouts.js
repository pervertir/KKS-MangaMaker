import { $, h } from "./core.js";
import { commit } from "./history.js";
import { thumb } from "./images.js";
import { closeModal, modal } from "./modal.js";
import { renderPages } from "./pages.js";
import { H, S, W, layers, normalize, page } from "./state.ts";
import { panelOrder, requestDraw } from "./view.js";

/* ================================================================ layouts */
export function gridRects(rows, heights, margin = 60, gutter = 30, line = 4) {
  const avH = H() - 2 * margin - gutter * (rows.length - 1), out = [];
  let y = margin;
  rows.forEach((row, i) => {
    const hh = avH * heights[i] / heights.reduce((a, b) => a + b, 0);
    const avW = W() - 2 * margin - gutter * (row.length - 1);
    let x = margin;
    for (const cw of row) { const w = avW * cw / row.reduce((a, b) => a + b, 0); out.push([x + line, y + line, w - 2 * line, hh - 2 * line]); x += w + gutter; }
    y += hh + gutter;
  });
  return out;
}
export function applyLayout(rects, label) {
  const ls = layers(), old = panelOrder(ls);
  const keep = ls.filter(l => l.type !== "panel");
  const sx = W() / 1800, sy = H() / 2700;
  const fresh = rects.map(([x, y, w, hh]) => normalize({ pages: [{ layers: [{ type: "panel", x: x * sx, y: y * sy, w: w * sx, h: hh * sy, shot: "", image: null }] }] }).pages[0].layers[0]);
  const order = panelOrder(fresh);
  order.forEach((p, i) => { const o = old[i]; if (o) { p.image = o.image; p.shot = o.shot; p.border = o.border; p.borderColor = o.borderColor; } });
  page().layers = [...fresh, ...keep];
  S.sel = null; commit("Layout " + label); requestDraw(); renderPages();
}
/* classic manga page grids, built in so a page can be laid out with no template pack installed:
   rows of relative widths, then relative row heights */
export const PRESET_LAYOUTS = [
  ["Splash", [[1]], [1]], ["Two tiers", [[1], [1]], [1, 1]], ["Three tiers", [[1], [1], [1]], [1, 1, 1]],
  ["4-koma", [[1], [1], [1], [1]], [1, 1, 1, 1]], ["Classic six", [[1, 1], [1, 1], [1, 1]], [1, 1, 1]],
  ["Establishing + 4", [[1], [1, 1], [1, 1]], [1.3, 1, 1]], ["1 · 2 · 1", [[1], [1, 1], [1]], [1, 1.2, 1]],
  ["Action stack", [[2, 1], [1], [1, 2]], [1, 1.4, 1]], ["Dialogue grid", [[1, 1, 1], [1, 1], [1, 1, 1]], [1, 1.2, 1]],
  ["Big reveal", [[1, 1], [1]], [1, 2.2]], ["Tall + stack", [[1], [1, 1, 1]], [2, 1]], ["Nine grid", [[1, 1, 1], [1, 1, 1], [1, 1, 1]], [1, 1, 1]],
];
export function presetThumb(rows, hs) {
  const c = document.createElement("canvas"); c.width = 120; c.height = 180;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 120, 180);
  g.strokeStyle = "#111"; g.lineWidth = 2;
  for (const [x, y, w, hh] of gridRects(rows, hs)) g.strokeRect(x / W() * 120, y / H() * 180, w / W() * 120, hh / H() * 180);
  return c;
}
export function presetTiles(onPick) {
  const t = h("div", { class: "tiles" });
  for (const [name, rows, hs] of PRESET_LAYOUTS) {
    const ord = S.doc.reading === "rtl" ? rows.map(r => [...r].reverse()) : rows;
    t.append(h("div", { class: "tile page", title: name, onclick: () => onPick(gridRects(ord, hs), name) }, presetThumb(ord, hs), h("div", { class: "cap" }, name)));
  }
  return t;
}
export function layoutDialog() {
  const box = modal("Page layout", "");
  const grid = h("div", { class: "layoutgrid" });
  for (const L of S.cat.layouts) {
    grid.append(h("div", { class: "tile page", title: `Template ${L.n}: ${L.rects.length} panels`, onclick: () => { applyLayout(L.rects, "#" + L.n); closeModal(); } },
      h("img", { src: thumb(L.ref, 180), loading: "lazy" }), h("div", { class: "cap" }, `#${L.n} · ${L.rects.length}`)));
  }
  const rowsIn = h("input", { value: "1 | 1 1 | 2 1", style: "flex:1", title: "rows separated by |, relative widths inside a row" });
  const hIn = h("input", { value: "1 1 1", style: "width:120px", title: "relative row heights" });
  const mIn = h("input", { type: "number", value: 60, style: "width:64px" }), gIn = h("input", { type: "number", value: 30, style: "width:64px" });
  $(".mbody", box).append(
    h("div", { class: "row" }, h("label", {}, "Custom grid"), rowsIn, h("span", { class: "hint" }, "heights"), hIn,
      h("span", { class: "hint" }, "margin"), mIn, h("span", { class: "hint" }, "gutter"), gIn,
      h("button", { class: "primary", onclick: () => {
        const rows = rowsIn.value.split("|").map(r => r.trim().split(/\s+/).map(Number).filter(n => n > 0)).filter(r => r.length);
        let hs = hIn.value.trim().split(/\s+/).map(Number).filter(n => n > 0);
        if (hs.length !== rows.length) hs = rows.map(() => 1);
        applyLayout(gridRects(rows, hs, +mIn.value, +gIn.value), "grid"); closeModal();
      } }, "Apply grid")),
    h("p", { class: "hint" }, "Applying a layout replaces this page's panels. Renders already placed move into the new panels in reading order; bubbles and text stay."),
    h("div", { class: "section" }, "Built-in"), presetTiles((r, n) => { applyLayout(r, n); closeModal(); }),
    S.cat.layouts.length ? h("div", { class: "section" }, "Template pack") : null,
    grid);
}
