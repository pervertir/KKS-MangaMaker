import { act } from "./actions.js";
import { enterAdjust } from "./adjust.js";
import { $, $$, h } from "./core.js";
import { setPanelImage } from "./creation.js";
import { showLib } from "./dock-tabs.js";
import { commit } from "./history.js";
import { thumb } from "./images.js";
import { renderShot } from "./jobs.js";
import { layoutDialog } from "./layouts.js";
import { VSHAPES } from "./manga-tools.js";
import { refreshPanels } from "./misc.js";
import { shotDialog } from "./shots.js";
import { S, bubbleMeta, layers, page, selL } from "./state.js";
import { FONTS, LAZY_FONTS, loadFontCss } from "./text.js";
import { TONE_PRESETS, keyLabel, sc } from "./tools.js";
import { panelOrder, requestDraw, isPolyPanel } from "./view.js";
import { poseForPanel } from "../pose/open.js";
import { FRAME_EDGES, FRAME_SHAPES, frameShapeKey, tracePanel } from "./frames.js";


/* ================================================================ panels: properties */
export function num(label, l, key, opt = {}) {
  const inp = h("input", { type: "number", value: Math.round((l[key] ?? 0) * (opt.mul || 1) * 100) / 100, step: opt.step || 1,
    onchange: () => { l[key] = +inp.value / (opt.mul || 1); commit(); requestDraw(); } });
  inp.dataset.k = key;
  return h("label", {}, label, inp);
}
export function rowOf(label, ...kids) { return h("div", { class: "row" }, h("label", {}, label), ...kids); }
export function slider(label, get, set, min, max, step, fmt = v => v) {
  const val = h("span", { class: "val" }, fmt(get()));
  const r = h("input", { type: "range", min, max, step, value: get(),
    oninput: () => { set(+r.value); val.textContent = fmt(+r.value); requestDraw(); }, onchange: () => commit() });
  return rowOf(label, r, val);
}
export function check(label, get, set) {
  return h("label", { style: "display:flex;gap:5px;align-items:center;color:var(--muted)" },
    h("input", { type: "checkbox", checked: !!get(), onchange: e => { set(e.target.checked); commit(); requestDraw(); } }), label);
}
export function colorRow(label, l, key, allowAuto) {
  const isAuto = l[key] === "auto";
  const c = h("input", { type: "color", value: isAuto ? "#111111" : (l[key] || "#000000"), oninput: () => { l[key] = c.value; requestDraw(); if (a) a.checked = false; }, onchange: () => commit() });
  const a = allowAuto ? h("input", { type: "checkbox", checked: isAuto, onchange: e => { l[key] = e.target.checked ? "auto" : c.value; commit(); requestDraw(); } }) : null;
  return rowOf(label, c, allowAuto ? h("label", { style: "display:flex;gap:4px;align-items:center;color:var(--muted)" }, a, "auto") : null);
}
export function select(label, opts, get, set) {
  const s = h("select", { onchange: () => { set(s.value); commit(); requestDraw(); } }, ...opts.map(([v, t]) => h("option", { value: v, selected: String(get()) === String(v) }, t)));
  return rowOf(label, s);
}
export function textBlock(l) {
  const ta = h("textarea", { class: "big", value: l.text || "", placeholder: "Dialogue… (double-click the bubble to type on the page)",
    oninput: () => { l.text = ta.value; requestDraw(); }, onchange: () => commit("Text edited") });
  return ta;
}
export function fontRows(l) {
  return [
    (() => { const r = select("Font", FONTS, () => l.font || "MMComic", v => l.font = v);   // fetch the faces when the list opens
      $("select", r)?.addEventListener("pointerdown", () => Object.keys(LAZY_FONTS).forEach(loadFontCss), { once: true }); return r; })(),
    h("div", { class: "row" }, h("label", {}, "Size"),
      h("input", { type: "number", min: 0, value: l.fontSize || 0, style: "width:56px", title: "Text size in page px; 0 fits the text to its box", onchange: e => { l.fontSize = +e.target.value; commit(); requestDraw(); } }),
      check("Bold", () => l.bold, v => l.bold = v), check("Italic", () => l.italic, v => l.italic = v), h("span", { class: "hint" }, "0 = fit")),
  ];
}
export function refreshProps(valuesOnly) {
  const l = selL();
  if (valuesOnly && l) { // keep focus: only update geometry fields
    $$("#props input[data-k]").forEach(i => { if (document.activeElement !== i) i.value = Math.round((l[i.dataset.k] ?? 0) * 100) / 100; });
    return;
  }
  const P = $("#props"); P.innerHTML = "";
  $("#propstitle").textContent = l ? ({ panel: "Panel", bubble: "Speech bubble", caption: "Caption", text: l.sfx ? "Sound effect" : "Text", image: "Image", vbubble: "Drawn bubble", tone: "Screentone", speed: l.mode === "focus" ? "Focus lines" : "Speed lines" })[l.type] : `Page ${S.page + 1}`;
  if (!l) return pageProps(P);
  P.append(h("div", { class: "grid4" }, num("X", l, "x"), num("Y", l, "y"), num("W", l, "w"), num("H", l, "h")));
  if (l.type !== "panel") P.append(h("div", { class: "row" }, h("label", {}, "Rotate"), h("input", { type: "number", value: l.rotate || 0, step: 1, "data-k": "rotate",
    onchange: e => { l.rotate = +e.target.value; commit(); requestDraw(); } }), h("span", { class: "hint" }, "°  Shift snaps 15°")));
  if (l.type === "panel") panelProps(P, l);
  if (l.type === "bubble") {
    const m = bubbleMeta(l.bubble);
    P.append(textBlock(l),
      rowOf("Template", h("img", { src: thumb(m.ref, 120), style: "height:44px;background:#e9e9ec;border-radius:4px;padding:2px" }),
        h("button", { onclick: () => showLib("bubbles") }, `#${m.key} · change…`)),
      ...fontRows(l), colorRow("Text color", l, "color", true),
      h("div", { class: "btnrow" }, check("Flip tail", () => l.flip, v => l.flip = v), check("Vertical text", () => l.vertical, v => l.vertical = v)));
  }
  if (l.type === "caption") {
    P.append(textBlock(l), ...fontRows(l), colorRow("Text color", l, "color", true), colorRow("Fill", l, "fill"),
      h("div", { class: "row" }, h("label", {}, "Border"), h("input", { type: "number", min: 0, value: l.borderW, onchange: e => { l.borderW = +e.target.value; commit(); requestDraw(); } })));
  }
  if (l.type === "text") {
    P.append(textBlock(l), ...fontRows(l), colorRow("Color", l, "color"), colorRow("Outline", l, "stroke"),
      slider("Outline w", () => l.strokeWidth || 0, v => l.strokeWidth = v, 0, 40, 1),
      select("Align", [["center", "Center"], ["left", "Left"], ["right", "Right"]], () => l.align || "center", v => l.align = v),
      h("div", { class: "btnrow" }, check("Vertical (tategaki)", () => l.vertical, v => l.vertical = v)));
  }
  if (l.type === "image") P.append(h("div", { class: "btnrow" }, check("Flip", () => l.flip, v => l.flip = v)));
  const clipRow = () => select("Clip to", [["", "— none —"], ...panelOrder(layers()).map((q, i) => [q.id, `Panel ${i + 1}${q.shot ? " · " + q.shot : ""}`])],
    () => l.clip || "", v => l.clip = v || null);
  const reseed = () => h("button", { onclick: () => { l.seed = Math.floor(Math.random() * 1e6); commit("Reshuffled"); requestDraw(); } }, "Reshuffle");
  if (l.type === "vbubble") {
    P.append(textBlock(l), select("Shape", VSHAPES, () => l.shape, v => l.shape = v), ...fontRows(l), colorRow("Text color", l, "color", true),
      h("div", { class: "row" }, h("label", {}, "Fill / line"),
        h("input", { type: "color", value: l.fill, oninput: e => { l.fill = e.target.value; requestDraw(); }, onchange: () => commit() }),
        h("input", { type: "color", value: l.stroke, oninput: e => { l.stroke = e.target.value; requestDraw(); }, onchange: () => commit() }),
        h("input", { type: "number", min: 0, value: l.strokeW, style: "width:56px", title: "line width", onchange: e => { l.strokeW = +e.target.value; commit(); requestDraw(); } })),
      slider("Tail width", () => l.tailW, v => l.tailW = v, 0.05, 0.6, 0.01, v => v.toFixed(2)),
      ["burst", "flash"].includes(l.shape) ? slider("Spikes", () => l.spikes, v => l.spikes = v, 6, 48, 1) : null,
      h("div", { class: "btnrow" },
        h("button", { onclick: () => { l.tail = l.tail ? null : { x: -l.w * 0.18, y: l.h * 0.85 }; commit(); requestDraw(); refreshProps(); } }, l.tail ? "Remove tail" : "Add tail"),
        ["cloud", "burst", "flash"].includes(l.shape) ? reseed() : null, check("Vertical text", () => l.vertical, v => l.vertical = v)),
      h("p", { class: "hint" }, "Drag the pink dot to aim the tail."));
  }
  if (l.type === "tone") {
    P.append(select("Preset", [["", "— apply a preset —"], ...TONE_PRESETS.map(([t], i) => [i, t])], () => "", v => { if (v !== "") Object.assign(l, TONE_PRESETS[+v][1]); refreshProps(); }),
      select("Pattern", [["dots", "Dots (amitone)"], ["lines", "Lines"], ["cross", "Crosshatch"], ["noise", "Sand / noise"], ["solid", "Flat"]], () => l.pattern, v => l.pattern = v),
      slider("Cell size", () => l.size, v => l.size = v, 3, 40, 1, v => v + "px"),
      slider("Density", () => l.density, v => l.density = v, 0.02, 1, 0.01, v => Math.round(v * 100) + "%"),
      slider("Angle", () => l.angle, v => l.angle = v, 0, 180, 1, v => v + "°"),
      select("Gradient", [["none", "None"], ["down", "Fade downward"], ["up", "Fade upward"], ["right", "Fade to the right"], ["left", "Fade to the left"],
        ["edges", "Dark edges (vignette)"], ["center", "Dark centre"]], () => l.fade, v => l.fade = v),
      colorRow("Color", l, "color"), clipRow(), l.pattern === "noise" ? h("div", { class: "btnrow" }, reseed()) : null);
  }
  if (l.type === "speed") {
    P.append(select("Kind", [["focus", "Focus lines (集中線)"], ["parallel", "Speed lines (流線)"]], () => l.mode, v => l.mode = v),
      slider("Lines", () => l.count, v => l.count = v, 10, 600, 1),
      slider("Thickness", () => l.thick, v => l.thick = v, 1, 60, 0.5),
      slider(l.mode === "focus" ? "Empty centre" : "Gap", () => l.inner, v => l.inner = v, 0, 0.95, 0.01, v => Math.round(v * 100) + "%"),
      slider("Jitter", () => l.jitter, v => l.jitter = v, 0, 1, 0.01, v => Math.round(v * 100) + "%"),
      l.mode === "parallel" ? slider("Direction", () => l.angle, v => l.angle = v, -90, 90, 1, v => v + "°") : null,
      colorRow("Color", l, "color"), clipRow(), h("div", { class: "btnrow" }, reseed()));
  }
  P.append(h("div", { class: "section" }, "Layer"),
    slider("Opacity", () => l.opacity ?? 1, v => l.opacity = v, 0, 1, 0.01, v => Math.round(v * 100) + "%"),
    select("Blend", [["source-over", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"], ["lighten", "Lighten"], ["difference", "Difference"]],
      () => l.blend, v => l.blend = v),
    h("div", { class: "btnrow" }, h("button", { onclick: act.duplicate }, "Duplicate"), h("button", { class: "danger", onclick: act.remove }, "Delete")));
}
export function panelProps(P, l) {
  const shot = S.shots.find(s => s.name === l.shot);
  P.append(h("div", { class: "section" }, "Shot"),
    select("Shot", [["", "— none —"], ...S.shots.map(s => [s.name, s.name + (s.renders.length ? "" : " (no render)")])], () => l.shot || "", v => {
      l.shot = v; const s = S.shots.find(q => q.name === v);
      if (s?.renders[0]) setPanelImage(l, s.renders[0], v); else { l.image = null; }
    }));
  if (shot && (shot.renders.length || shot.finals.length)) {
    P.append(h("div", { class: "renders" }, ...[...shot.renders, ...shot.finals].map(ref =>
      h("img", { src: thumb(ref, 160), class: l.image?.ref === ref ? "on" : "", title: ref.split("/").pop(), onclick: () => setPanelImage(l, ref, shot.name) }))));
  }
  P.append(h("div", { class: "btnrow" },
    h("button", { onclick: () => shotDialog(l.shot || null) }, "Edit shot…"),
    h("button", { onclick: () => poseForPanel(l), title: "Pose the characters for this panel (no game needed)" }, "Pose…"),
    l.shot ? h("button", { class: "primary", onclick: () => renderShot(l.shot) }, "Render on pod") : null));
  if (l.image) {
    const I = l.image;
    P.append(h("div", { class: "section" }, "Render in panel"),
      select("Fit", [["cover", "Cover (crop)"], ["contain", "Contain"]], () => I.fit, v => { I.fit = v; I.zoom = 1; }),
      slider("Zoom", () => I.zoom || 1, v => I.zoom = v, I.fit === "contain" ? 0.2 : 1, 5, 0.01, v => v.toFixed(2) + "×"),
      h("div", { class: "btnrow" }, check("Flip", () => I.flip, v => I.flip = v), check("B/W", () => I.gray, v => I.gray = v),
        h("button", { onclick: () => enterAdjust(l) }, "Reposition (Enter)"),
        h("button", { onclick: () => { l.image = null; commit("Image removed"); requestDraw(); refreshPanels(); } }, "Remove image")));
  }
  const cur = frameShapeKey(l);
  P.append(h("div", { class: "section" }, "Frame"),
    h("div", { class: "shapes" }, ...FRAME_SHAPES.map(([k, t]) => h("button", { class: "shapebtn" + (cur === k ? " on" : ""), title: t, onclick: () => act.frame(k) }, frameIcon(k)))),
    select("Edge", FRAME_EDGES, () => l.edge || "solid", v => { l.edge = v; if (v === "jagged" || v === "wavy") l.seed ??= 1; }),
    ...(l.shape === "rect" ? [slider("Corners", () => l.radius || 0, v => l.radius = v, 0, Math.round(Math.min(l.w, l.h) / 2), 1, v => Math.round(v) + " px")] : []),
    h("div", { class: "row" }, h("label", {}, "Gap"), h("input", { type: "number", min: 0, value: l.gap || 0, style: "width:64px", title: "Paper-coloured band outside the border, for an inset laid over another panel",
      onchange: e => { l.gap = Math.max(0, +e.target.value); commit(); requestDraw(); } }), h("span", { class: "hint" }, "px around an inset")),
    h("div", { class: "row" }, h("label", {}, "Border"), h("input", { type: "number", min: 0, value: l.border, style: "width:64px", onchange: e => { l.border = +e.target.value; commit(); requestDraw(); } }),
      h("input", { type: "color", value: l.borderColor, oninput: e => { l.borderColor = e.target.value; requestDraw(); }, onchange: () => commit() }),
      h("span", { class: "hint" }, "fill"), h("input", { type: "color", value: l.fill, oninput: e => { l.fill = e.target.value; requestDraw(); }, onchange: () => commit() })),
    h("div", { class: "btnrow" }, h("button", { onclick: () => act.split("v") }, "Split ⇆"), h("button", { onclick: () => act.split("h") }, "Split ⇅"),
      h("button", { title: "Split with a slanted gutter, side by side (" + sc("Slanted split side by side") + ")", onclick: () => act.split("v", 12) }, "Slant ⇆"),
      h("button", { title: "Split with a slanted gutter, top / bottom (" + sc("Slanted split top / bottom") + ")", onclick: () => act.split("h", -7) }, "Slant ⇅")),
    h("div", { class: "btnrow" },
      h("button", { title: "Make every corner draggable (drag the dots between corners to add one)", disabled: l.shape === "ellipse", onclick: act.editCorners }, isPolyPanel(l) ? "Corners: drag on page" : "Edit corners"),
      h("button", { title: "Run the panel off the page edges it is near (a bleed panel)", onclick: act.bleed }, "Bleed"),
      h("button", { title: "No border (a borderless panel)", onclick: () => { l.border = 0; commit("Borderless"); requestDraw(); refreshProps(); } }, "Borderless")),
    ...(isPolyPanel(l) ? [h("p", { class: "hint" }, (l.locked ? `Unlock the panel (${keyLabel("mod+l")}), then drag` : "Drag") + " a corner, drag a small dot to add a corner, ⌥-click a corner to remove it. Shift keeps it level, Ctrl skips snapping.")] : []));
}
/* a tiny picture of a frame shape for the Properties buttons */
export function frameIcon(key) {
  const c = h("canvas", { width: 44, height: 44 }), g = c.getContext("2d"), s = FRAME_SHAPES.find(f => f[0] === key)[2];
  g.fillStyle = "#e9e9ee"; g.strokeStyle = "#111"; g.lineWidth = 3;
  const l = { x: 8, y: 6, w: 28, h: 32, ...s, radius: s.radius ? 8 : 0 };
  g.beginPath(); tracePanel(g, l); g.fill(); g.stroke();
  return c;
}
export function pageProps(P) {
  const pg = page();
  P.append(
    rowOf("Title", h("input", { value: S.doc.title, style: "flex:1", onchange: e => { S.doc.title = e.target.value; commit(); } })),
    select("Reading", [["rtl", "Right to left (manga)"], ["ltr", "Left to right"]], () => S.doc.reading, v => S.doc.reading = v),
    colorRow("Paper", pg, "bg"),
    h("div", { class: "row" }, h("label", {}, "Max text"), h("input", { type: "number", value: S.doc.maxFont, onchange: e => { S.doc.maxFont = +e.target.value; commit(); requestDraw(); } }),
      h("span", { class: "hint" }, "px, keeps fitted text even")),
    h("div", { class: "btnrow" }, h("button", { onclick: layoutDialog }, "Choose layout…")),
    h("p", { class: "hint" }, "Pick a layout, drag renders from the Library onto panels, then letter the page with bubbles, text and sound effects."));
}
