import { h } from "../editor/core.js";
import { toast } from "../editor/misc.js";
import { project } from "./geometry.js";
import { P, shownPts } from "./model.js";
import { turnAll } from "./pointer.js";
import { pcommit } from "./scene.js";

/* ---------------------------------------------------------------- shot presets */
/* Framing = how much of the body fills the frame, measured from the top of the head down
   (fractions of the figure's height). The camera words manga storyboards use. */
export const FRAMINGS = [["Full body", 1.0, "Whole figure, feet in frame: establishing, action"], ["Knees up", 0.72, "Cowboy shot: stance and hands"],
  ["Waist up", 0.5, "Medium shot: most dialogue panels"], ["Chest up", 0.33, "Medium close-up: reactions"], ["Close-up", 0.2, "Face fills the panel: emotion"]];
export const ANGLES = [["Eye level", 0, 0, "Neutral"], ["Low angle", -18, 0, "Camera below: power, threat"], ["High angle", 22, 0, "Camera above: small, vulnerable"], ["Dutch tilt", 0, 12, "Tilted frame: unease, chaos"]];
export const ARRANGE = [["Line-up", "Side by side, facing the reader"], ["Facing", "Two characters face each other (talking, confrontation)"],
  ["Over the shoulder", "First character close, back to the camera; the second faces us"], ["Foreground / back", "One close in front, the other small behind"]];

export function figureExtent(c) {               // head top and lowest point at the figure's own scale, in px
  const pr = project(c, P.scene.w, P.scene.h); if (!pr) return null;
  const ys = shownPts(pr).map(p => p[1]);
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}
export function applyFraming(frac) {
  const { h: H } = P.scene, chars = P.scene.chars.filter(c => !c.hidden);
  if (!chars.length) return toast("Add a character first", "err");
  for (const c of chars) {
    let e = figureExtent(c); if (!e) continue;
    c.scale *= (H * 0.9) / (frac * (e.bottom - e.top));     // visible part spans 90% of the frame
    e = figureExtent(c);
    c.y += (H * 0.06 - e.top) / H;                           // head top just under the frame edge
  }
  pcommit("Framing");
}
export function applyAngle(pitch, roll) { for (const c of P.scene.chars) { c.pitch = pitch; c.roll = roll; } pcommit("Camera angle"); }
export function applyArrange(kind) {
  const cs = P.scene.chars.filter(c => !c.hidden).sort((a, b) => a.x - b.x);
  if (!cs.length) return toast("Add a character first", "err");
  if (kind === "Line-up") cs.forEach((c, i) => { c.x = (i + 1) / (cs.length + 1); c.yaw = 0; c.flip = false; });
  else if (cs.length < 2) return toast("This needs two characters", "err");
  else if (kind === "Facing") { const [a, b] = cs; a.x = 0.32; b.x = 0.68; a.yaw = 40; b.yaw = -40; b.scale = a.scale; b.y = a.y; }
  else if (kind === "Over the shoulder") {
    const [a, b] = cs; a.x = 0.24; a.yaw = 155; a.scale = b.scale * 1.7; a.y = b.y + 0.35; b.x = 0.66; b.yaw = -20;
    P.scene.chars.splice(P.scene.chars.indexOf(a), 1); P.scene.chars.push(a);        // the near figure draws on top
  } else if (kind === "Foreground / back") { const [a, b] = cs; a.x = 0.3; a.scale = b.scale * 1.35; a.y = b.y + 0.12; b.x = 0.68; b.scale *= 0.75; b.y -= 0.12; }
  pcommit(kind);
}
export function presetSection() {
  const btns = (list, fn) => h("div", { class: "btnrow" }, ...list.map(it => h("button", { title: it[it.length - 1], onclick: () => fn(it) }, it[0])));
  return [h("div", { class: "section" }, "Shot presets"),
    h("div", { class: "hint", style: "margin-top:0" }, "Framing"), btns(FRAMINGS, it => applyFraming(it[1])),
    h("div", { class: "hint" }, "Camera"), btns(ANGLES, it => applyAngle(it[1], it[2])),
    h("div", { class: "hint" }, "Staging"), btns(ARRANGE, it => applyArrange(it[0])),
    h("div", { class: "hint" }, "Turn everyone (keeps a group pose together)"),
    h("div", { class: "btnrow" }, ...[["⟲ 90°", -90], ["⟲ 45°", -45], ["⟳ 45°", 45], ["⟳ 90°", 90], ["180°", 180]].map(([t, d]) =>
      h("button", { onclick: () => { if (!P.scene.chars.length) return toast("Add characters first", "err"); turnAll(d); pcommit("Turned everyone " + d + "°"); } }, t)))];
}
