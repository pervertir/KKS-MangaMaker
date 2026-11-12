import { act } from "./actions.js";
import { $, h } from "./core.js";
import { setDockTab } from "./dock-tabs.js";
import { drawLayer } from "./drawing.js";
import { commit } from "./history.js";
import { IMG, LEVELS } from "./images.js";
import { popMenu } from "./menus.js";
import { refreshPanels } from "./misc.js";
import { S, bubbleMeta, layers, selL } from "./state.js";
import { deleteSelected, sc } from "./tools.js";
import { requestDraw } from "./view.js";

/* ================================================================ layers list */
export const TYPE_IC = { panel: "▭", bubble: "💬", vbubble: "🗨", caption: "▤", text: "T", image: "🖼", tone: "▦", speed: "✺" };
export function layerName(l) {
  if (l.name) return l.name;
  if (l.type === "panel") return "Panel" + (l.shot ? ` · ${l.shot}` : "");
  if (l.type === "image") return l.ref.split("/").pop();
  if (l.type === "tone") return `Screentone · ${l.pattern}${l.fade !== "none" ? " " + l.fade : ""}`;
  if (l.type === "speed") return l.mode === "focus" ? "Focus lines" : "Speed lines";
  const t = (l.text || "").replace(/\s+/g, " ").trim();
  return (l.sfx ? "SFX" : l.type === "bubble" || l.type === "vbubble" ? "Bubble" : l.type === "caption" ? "Caption" : "Text") + (t ? ` · ${t}` : "");
}
/* monochrome line icons (currentColor), so they follow the theme instead of emoji colours */
export const UI_ICON = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
export function svgIcon(name) { return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${UI_ICON[name]}</svg>`; }
export function svgBtn(name, cls, title, fn) {
  const b = h("button", { class: "ib " + (cls || ""), title, onclick: e => { e.stopPropagation(); fn(); } }); b.innerHTML = svgIcon(name); return b;
}
/* a small picture of the layer itself, like Photoshop's layer thumbnails (T = its size in the list) */
export const THUMBS = new Map();   // layer id -> {key, canvas}: redrawn only when the layer changes
export function layerThumb(l, T = 32) {
  const refs = [l.image?.ref, l.type === "bubble" ? bubbleMeta(l.bubble)?.ref : null].filter(Boolean);
  const loaded = refs.map(r => [0, ...LEVELS].map(w => IMG.get(r + "|" + w)?.complete ? 1 : 0).join("")).join("/");
  const key = T + "|" + JSON.stringify(l) + "|" + loaded;
  const hit = THUMBS.get(l.id);
  if (hit && hit.key === key) return hit.canvas;
  const c = paintLayerThumb(l, T); THUMBS.set(l.id, { key, canvas: c });
  if (THUMBS.size > 600) THUMBS.delete(THUMBS.keys().next().value);
  return c;
}
export function paintLayerThumb(l, T = 32) {
  const c = h("canvas", { class: "lthumb", width: T * 2, height: T * 2 });
  const g = c.getContext("2d"), pad = 2;
  const w = Math.max(1, l.w), hh = Math.max(1, l.h), s = (T * 2 - pad * 2) / Math.max(w, hh);
  g.fillStyle = "#d4d4da"; g.fillRect(0, 0, T * 2, T * 2);
  g.save(); g.translate(T - (l.x + w / 2) * s, T - (l.y + hh / 2) * s); g.scale(s, s);
  try { drawLayer(g, { ...l, visible: true, opacity: 1 }, { rs: s, export: true }); } catch { }
  g.restore();
  return c;
}
export function layerMenu() {
  return [["Delete", deleteSelected, "Del", !selL()], ["Duplicate", act.duplicate, sc("Duplicate layer")], null,
    ["Bring forward", act.layerUp, sc("Bring forward")], ["Send backward", act.layerDown, sc("Send backward")],
    ["Bring to front", act.toFront, sc("Bring to front")], ["Send to back", act.toBack, sc("Send to back")], null,
    ["Lock / unlock", act.toggleLock, sc("Lock / unlock")], ["Hide / show", act.toggleHide, sc("Hide / show")]];
}
/* a list is rebuilt on every change: keep where it was scrolled, and bring the picked row into view only when the pick changes */
export const LISTSEL = {};
export function rebuildList(box, build) {
  const y = box.scrollTop; box.innerHTML = ""; build(); box.scrollTop = y;
  if (LISTSEL[box.id] !== S.sel) { LISTSEL[box.id] = S.sel; box.querySelector(".on")?.scrollIntoView({ block: "nearest" }); }
}
/* Layers tab: everything except the frames, front to back. A run of panels is one marker row, so the
   stack stays truthful (a tone can sit over or under the frames) while the frames live in the Panels tab. */
export function renderLayers() {
  const box = $("#layers"), ls = layers(), rev = [...ls].reverse();
  let n = 0;
  rebuildList(box, () => {
    for (let i = 0; i < rev.length; i++) {
      if (rev[i].type !== "panel") { n++; box.append(layerRow(rev[i], ls)); continue; }
      let j = i; while (j + 1 < rev.length && rev[j + 1].type === "panel") j++;
      box.append(panelRunRow(rev.slice(i, j + 1), ls)); i = j;
    }
    if (!n) box.prepend(h("div", { class: "empty" }, "No lettering on this page yet. B bubble · O drawn bubble · T text · S sound effect · C caption."));
  });
  $("#cnt-layers").textContent = n || "";
}
export function layerRow(l, ls) {
  const row = h("div", { class: "layer" + (l.id === S.sel ? " on" : ""), draggable: true,
    onclick: () => { S.sel = l.id; refreshPanels(); requestDraw(); },
    ondblclick: () => { const n = prompt("Layer name", layerName(l)); if (n != null) { l.name = n; commit(); } },
    ondragstart: e => e.dataTransfer.setData("text/layer", l.id),
    ondragover: e => { e.preventDefault(); row.classList.add("dragover"); },
    ondragleave: () => row.classList.remove("dragover"),
    ondrop: e => {
      e.preventDefault(); row.classList.remove("dragover");
      const id = e.dataTransfer.getData("text/layer"), src = ls.find(q => q.id === id); if (!src || src === l) return;
      ls.splice(ls.indexOf(src), 1); ls.splice(ls.indexOf(l) + 1, 0, src); commit("Reordered"); requestDraw();
    } },
    svgBtn(l.visible ? "eye" : "eyeOff", l.visible ? "" : "offv", "Show / hide", () => { l.visible = !l.visible; commit(); requestDraw(); }),
    layerThumb(l),
    h("span", { class: "nm", title: layerName(l) }, layerName(l)),
    svgBtn(l.locked ? "lock" : "unlock", l.locked ? "" : "offv", l.locked ? "Unlock" : "Lock", () => { l.locked = !l.locked; commit(); requestDraw(); }),
    svgBtn("trash", "del", "Delete layer (Delete)", () => { S.sel = l.id; deleteSelected(); }));
  row.addEventListener("contextmenu", e => { e.preventDefault(); S.sel = l.id; refreshPanels(); requestDraw(); popMenu(e.clientX, e.clientY, layerMenu()); });
  return row;
}
export function panelRunRow(run, ls) {          // run[0] is the frontmost frame of the run
  const row = h("div", { class: "layer run" + (run.some(q => q.id === S.sel) ? " on" : ""), title: "The panel frames sit here in the stack. Click to work on them in the Panels tab; drop a layer here to put it just above them.",
    onclick: () => setDockTab("panels", true),
    ondragover: e => { e.preventDefault(); row.classList.add("dragover"); },
    ondragleave: () => row.classList.remove("dragover"),
    ondrop: e => {
      e.preventDefault(); row.classList.remove("dragover");
      const id = e.dataTransfer.getData("text/layer"), src = ls.find(q => q.id === id); if (!src) return;
      ls.splice(ls.indexOf(src), 1); ls.splice(ls.indexOf(run[0]) + 1, 0, src); commit("Reordered"); requestDraw();
    } },
    h("span", {}, "▭"), `${run.length} panel${run.length === 1 ? "" : "s"}`, h("span", { class: "go" }, "›"));
  return row;
}
