import { $, h, post } from "./core.js";
import { addImageLayer, createAt, setPanelImage } from "./creation.js";
import { commit } from "./history.js";
import { hitLayer } from "./hit.js";
import { imgW, thumb } from "./images.js";
import { renderShot } from "./jobs.js";
import { applyLayout, presetTiles, shapedTiles } from "./layouts.js";
import { refreshPanels, status, toast } from "./misc.js";
import { renderOptions } from "./options.js";
import { loadShots, shotDialog } from "./shots.js";
import { S, selL } from "./state.js";
import { setTool } from "./tools.js";
import { cv, requestDraw, stage, toPage, toScreen } from "./view.js";

/* ================================================================ library */
export const LIBTABS = [["shots", "Shots"], ["bubbles", "Bubbles"], ["layouts", "Layouts"], ["decor", "Decor"], ["speedlines", "Speed lines"], ["particles", "Particles"], ["uploads", "Uploads"]];
export function renderLibrary() {
  const tabs = $("#libtabs"); tabs.innerHTML = "";
  for (const [k, t] of LIBTABS) tabs.append(h("button", { class: S.libTab === k ? "on" : "", onclick: () => { S.libTab = k; renderLibrary(); } }, t));
  const tools = $("#libtools"); tools.innerHTML = "";
  const lib = $("#library"); lib.innerHTML = "";
  const drag = (el, data) => { el.draggable = true; el.addEventListener("dragstart", e => e.dataTransfer.setData("application/x-manga", JSON.stringify(data))); };
  if (S.libTab === "shots") {
    tools.append(h("button", { onclick: () => shotDialog(null, true) }, "＋ New shot"), h("button", { onclick: () => shotDialog(null) }, "Edit shots…"),
      h("button", { onclick: loadShots, title: "Rescan shots/" }, "⟳"));
    if (!S.shots.length) lib.append(h("div", { class: "hint" }, "No shots yet. Create one, pose it in CharaStudio, then Grab and Render."));
    for (const s of S.shots) {
      const imgs = h("div", { class: "imgs" });
      const all = [...s.renders.map(r => [r, "render"]), ...s.finals.map(r => [r, "final"])];
      for (const [ref, kind] of all) {
        const im = h("img", { src: thumb(ref, 200), title: `${kind}: ${ref.split("/").pop()} — drag onto a panel`, loading: "lazy",
          onclick: () => { const l = selL(); if (l?.type === "panel") setPanelImage(l, ref, s.name); else status("Select a panel, or drag the render onto one"); } });
        drag(im, { kind: "render", ref, shot: s.name }); imgs.append(im);
      }
      if (!all.length) imgs.append(...[s.pose && h("img", { src: thumb(s.pose, 200), title: "pose (not rendered yet)", style: "opacity:.7" }),
        h("div", { class: "none" }, s.pose ? "Not rendered yet." : "No pose yet: Grab from Studio.")].filter(Boolean));
      lib.append(h("div", { class: "shotcard" },
        h("div", { class: "top" }, h("b", { title: s.name }, s.name), h("span", {},
          h("span", { class: "badge" }, `${s.renders.length} render${s.renders.length === 1 ? "" : "s"}`), " ",
          h("button", { onclick: () => shotDialog(s.name) }, "Edit"), " ",
          h("button", { class: "primary", onclick: () => renderShot(s.name), disabled: !s.pose, title: "Render on the RunPod pod" }, "Render"))),
        imgs));
    }
    return;
  }
  if (S.libTab === "bubbles") {
    if (!S.cat.bubbles.length) { lib.append(h("div", { class: "hint" }, "No bubble templates installed (templates_dir in config). The drawn bubble tool (O) needs none.")); return; }
    lib.append(h("div", { class: "hint" }, "Click to pick for the bubble tool (or to swap the selected bubble). Drag onto the page to place."));
    const t = h("div", { class: "tiles" });
    for (const b of S.cat.bubbles) {
      const el = h("div", { class: "tile light" + (b.key === S.bubble ? " on" : ""), title: "#" + b.key, onclick: () => {
        S.bubble = b.key; const l = selL();
        if (l?.type === "bubble") { const k = l.w; l.bubble = b.key; l.h = k * b.h / b.w; commit("Bubble changed"); requestDraw(); }
        else setTool("bubble");
        renderLibrary(); renderOptions();
      } }, h("img", { src: thumb(b.ref, 160), loading: "lazy" }), h("div", { class: "cap" }, "#" + b.key));
      drag(el, { kind: "bubble", key: b.key }); t.append(el);
    }
    lib.append(t); return;
  }
  if (S.libTab === "layouts") {
    lib.append(h("div", { class: "hint" }, "Click to apply to this page (renders already placed carry over in reading order)."),
      h("div", { class: "section" }, "Built-in"), presetTiles((r, n) => applyLayout(r, n)),
      h("div", { class: "section" }, "Shaped frames"), shapedTiles((r, n) => applyLayout(r, n)));
    if (!S.cat.layouts.length) return;
    lib.append(h("div", { class: "section" }, "Template pack"));
    const t = h("div", { class: "tiles" });
    for (const L of S.cat.layouts) t.append(h("div", { class: "tile page", title: `Template ${L.n}: ${L.rects.length} panels`,
      onclick: () => applyLayout(L.rects, "#" + L.n) }, h("img", { src: thumb(L.ref, 160), loading: "lazy" }), h("div", { class: "cap" }, `#${L.n} · ${L.rects.length}`)));
    lib.append(t); return;
  }
  const list = S.cat.assets[S.libTab] || [];
  if (S.libTab === "uploads") {
    const fi = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, hidden: true, onchange: async () => { for (const f of fi.files) await uploadFile(f); } });
    tools.append(fi, h("button", { onclick: () => fi.click() }, "Upload images…"));
    if (!list.length) lib.append(h("div", { class: "hint" }, "Upload screentones, backgrounds or logos, or drop image files straight onto the page."));
  }
  const t = h("div", { class: "tiles wide" });
  for (const a of list) {
    const el = h("div", { class: "tile light", title: a.name + " — click to add, or drag", onclick: async () => {
      const dim = await imgSize(a.ref); addImageLayer(a.ref, dim.w, dim.h, null, a.multiply);
    } }, h("img", { src: thumb(a.ref, 260), loading: "lazy" }), h("div", { class: "cap" }, a.name));
    drag(el, { kind: "asset", ref: a.ref, multiply: a.multiply }); t.append(el);
  }
  lib.append(t);
}
export function imgSize(ref) {
  return new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.src = `/img?ref=${encodeURIComponent(ref)}&w=${imgW(ref)}`; });
}
export async function uploadFile(f, at) {
  try {
    const r = await post(`/api/upload?name=${encodeURIComponent(f.name)}`, f, true);
    S.cat.assets.uploads.push({ ref: r.ref, name: r.name, multiply: false });
    if (S.libTab === "uploads") renderLibrary();
    return r;
  } catch (e) { toast(e.message, "err"); }
}

/* drag & drop onto the canvas */
export const mark = $("#dropmark");

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_library() {
  stage.addEventListener("dragover", e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
    const pl = hitLayer(p, l => l.type === "panel");
    const isRender = e.dataTransfer.types.includes("application/x-manga") || e.dataTransfer.types.includes("Files");
    if (pl && isRender) {
      const a = toScreen(pl.x, pl.y);
      Object.assign(mark.style, { display: "block", left: a.x + "px", top: a.y + "px", width: pl.w * S.view.s + "px", height: pl.h * S.view.s + "px" });
    } else mark.style.display = "none";
  });

  stage.addEventListener("dragleave", () => mark.style.display = "none");

  stage.addEventListener("drop", async e => {
    e.preventDefault(); mark.style.display = "none";
    const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
    const pl = hitLayer(p, l => l.type === "panel");
    if (e.dataTransfer.files.length) {
      for (const f of e.dataTransfer.files) {
        const u = await uploadFile(f); if (!u) continue;
        if (pl && !pl.image) setPanelImage(pl, u.ref, ""); else addImageLayer(u.ref, u.w, u.h, p, false);
      }
      return;
    }
    const raw = e.dataTransfer.getData("application/x-manga"); if (!raw) return;
    const d = JSON.parse(raw);
    if (d.kind === "render") {
      if (pl) { S.sel = pl.id; setPanelImage(pl, d.ref, d.shot); }
      else { const dim = await imgSize(d.ref); addImageLayer(d.ref, dim.w, dim.h, p, false); }
    } else if (d.kind === "bubble") { S.bubble = d.key; createAt("bubble", { x: p.x, y: p.y, w: 0, h: 0 }, true); }
    else if (d.kind === "asset") { const dim = await imgSize(d.ref); addImageLayer(d.ref, dim.w, dim.h, p, d.multiply); }
    refreshPanels();
  });
}
