import { enterAdjust } from "./adjust.js";
import { deep, uid } from "./core.js";
import { createAt } from "./creation.js";
import { showLib } from "./dock-tabs.js";
import { commit } from "./history.js";
import { hitLayer } from "./hit.js";
import { showInline } from "./inline-edit.js";
import { refreshPanels, status } from "./misc.js";
import { startPan } from "./pointer.js";
import { refreshProps } from "./props.js";
import { snapBox } from "./snapping.js";
import { S, layers, selL } from "./state.ts";
import { ICON, keyLabel } from "./tools.js";
import { applyRotate, applyScale, beginTransform, boxHit } from "./transform-box.js";
import { cv, requestDraw, requestView, set_DC, stage } from "./view.js";
import { registerTool } from "../core/tools.ts";
import { cursorFor, frame } from "../core/transform.ts";

/* ================================================================ built-in tools */
/* tones and lines clipped to a panel move and stretch with it */
export function clipKids(l) {
  if (l.type !== "panel") return [];
  return layers().filter(q => q.clip === l.id).map(q => ({ q, x: q.x, y: q.y, w: q.w, h: q.h }));
}
export function followPanel(d, l) {
  if (!d.kids?.length || d.dup) return;
  const L = d.l0, sx = l.w / L.w, sy = l.h / L.h;
  for (const k of d.kids) { k.q.x = l.x + (k.x - L.x) * sx; k.q.y = l.y + (k.y - L.y) * sy; k.q.w = k.w * sx; k.q.h = k.h * sy; }
}
const pt = e => ({ x: e.raw.x, y: e.raw.y });
const finish = () => { S.drag = null; S.guides = []; set_DC(null); stage.classList.remove("grabbing"); requestDraw(); };

registerTool({
  id: "move", label: "Move / select", key: "v", icon: ICON.move, group: "nav", order: 0, cursor: "default",
  hover(e) {
    const p = pt(e), l = selL(), h = boxHit(l, p);
    cv.style.cursor = h ? (h.kind === "tail" ? "move" : cursorFor(h, l.rotate || 0)) : hitLayer(p) ? "move" : "default";
  },
  down(e) {
    const p = pt(e), cur = selL(), h = boxHit(cur, p);
    if (h) { S.drag = { ...beginTransform(cur, h, p), kids: clipKids(cur) }; return; }
    const hit = (e.alt || e.native.metaKey) ? hitLayer(p, l => l.type === "panel") : hitLayer(p);
    S.sel = hit ? hit.id : null;
    refreshPanels();
    if (hit && !hit.locked) S.drag = { layer: hit, l0: deep(hit), p0: p, move: true, dup: e.alt && !e.native.metaKey, kids: clipKids(hit) };
    else if (hit && hit.type === "panel") status(`Panel locked: ${keyLabel("mod+l")} unlocks it to move or resize (renders, Pose… and splitting still work)`);
    requestView();
  },
  move(e) {
    const d = S.drag; if (!d?.layer) return;
    const p = pt(e), l = d.layer, ev = e.native;
    if (d.dup && !d.duped) { d.duped = true; const c = deep(d.l0); c.id = uid(); layers().splice(layers().indexOf(l), 0, c); }
    if (d.move) {
      const box = { x: d.l0.x + p.x - d.p0.x, y: d.l0.y + p.y - d.p0.y, w: l.w, h: l.h };
      if (ev.shiftKey) { if (Math.abs(p.x - d.p0.x) > Math.abs(p.y - d.p0.y)) box.y = d.l0.y; else box.x = d.l0.x; }
      S.guides = S.showGuides && !ev.ctrlKey ? snapBox(box, l.id, 7 / S.view.s) : [];
      l.x = box.x; l.y = box.y;
      followPanel(d, l);
    } else if (d.handle?.kind === "tail") {
      const q = frame(l).toLocal([p.x, p.y]); l.tail = { x: +q[0].toFixed(1), y: +q[1].toFixed(1) };
    } else if (d.handle?.kind === "rotate") applyRotate(l, d, p, ev.shiftKey);
    else if (d.handle?.kind === "scale") { applyScale(l, d, p, ev); followPanel(d, l); }
    requestDraw(); refreshProps(true);
  },
  up() {
    const d = S.drag; finish();
    if (!d?.layer) return;
    const l = d.layer, k = d.handle?.kind;
    if (JSON.stringify(l) !== JSON.stringify(d.l0) || d.duped) commit(d.duped ? "Duplicated" : d.move ? "Moved" : k === "tail" ? "Tail moved" : k === "rotate" ? "Rotated" : "Resized");
  },
  cancel() {
    const d = S.drag;
    if (d?.layer && d.l0) { Object.assign(d.layer, deep(d.l0)); for (const k of d.kids || []) Object.assign(k.q, { x: k.x, y: k.y, w: k.w, h: k.h }); }
    finish();
  },
  dblclick(p) {
    const l = hitLayer(p);
    if (!l) return;
    S.sel = l.id;
    if (l.type === "panel") { if (l.image) enterAdjust(l); else { showLib("shots"); status("Drag a render from Shots onto the panel"); } }
    else if (["bubble", "caption", "text", "vbubble"].includes(l.type)) showInline(l);
    refreshPanels();
  },
});

registerTool({
  id: "hand", label: "Hand (or hold Space)", key: "h", icon: ICON.hand, group: "nav", order: 1, cursor: "grab",
  activate() { stage.classList.add("hand"); },
  deactivate() { stage.classList.remove("hand"); },
  down(e) { startPan(e.native); },
});

/* tools that drag out a box and create a layer in it (a click places a default size) */
function creator(id, label, key, group, order) {
  registerTool({
    id, label, key, icon: ICON[id], group, order,
    down(e) { const p = pt(e); S.drag = { creating: { x: p.x, y: p.y, w: 0, h: 0 }, p0: p, tool: id }; requestDraw(); },
    move(e) {
      const d = S.drag; if (!d?.creating) return;
      const p = pt(e), c = d.creating;
      c.x = Math.min(d.p0.x, p.x); c.y = Math.min(d.p0.y, p.y); c.w = Math.abs(p.x - d.p0.x); c.h = Math.abs(p.y - d.p0.y);
      S.guides = id === "panel" && S.showGuides ? snapBox({ ...c }, null, 7 / S.view.s) : [];
      requestDraw();
    },
    up() {
      const d = S.drag; finish();
      if (!d?.creating) return;
      const c = d.creating; createAt(id, c, c.w < 12 && c.h < 12);
    },
    cancel() { finish(); },
    dblclick(p) { const l = hitLayer(p); if (l && ["bubble", "caption", "text", "vbubble"].includes(l.type)) { S.sel = l.id; showInline(l); refreshPanels(); } },
  });
}
creator("panel", "Panel: drag a frame", "p", "frame", 10);
creator("bubble", "Template bubble", "b", "letter", 20);
creator("vbubble", "Drawn bubble with a draggable tail", "o", "letter", 21);
creator("text", "Text", "t", "letter", 22);
creator("sfx", "Sound effect", "s", "letter", 23);
creator("caption", "Caption box", "c", "letter", 24);
creator("tone", "Screentone: click a panel or drag an area", "g", "fx", 30);
creator("speed", "Speed / focus lines: click a panel or drag", "l", "fx", 31);
