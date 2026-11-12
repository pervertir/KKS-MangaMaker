import { uid } from "../editor/core.js";
import { status } from "../editor/misc.js";
import { P } from "./model.js";
import { renderPoseSide } from "./side.js";
import { pdraw } from "./view.js";

/* ---------------------------------------------------------------- scene model */
export function newScene(w = 832, h = 1216) { return { w, h, prompt: "", chars: [] }; }
export function newChar(poseId, x = 0.5, y = 0.92) {
  const n = (P.scene?.chars.length || 0) + 1;
  return { id: uid(), pose: poseId, name: "", series: "", tags: "", x, y, scale: 0.85, yaw: 0, pitch: 0, roll: 0, flip: false, hidden: false, edits: {}, label: `Character ${n}` };
}
export const pcur = () => P.scene.chars.find(c => c.id === P.sel) || null;
export function pcommit(msg) {
  P.undo.push(P.snap); if (P.undo.length > 200) P.undo.shift(); P.redo = [];
  P.snap = JSON.stringify(P.scene); P.dirty = true;
  if (msg) status(msg);
  pdraw(); renderPoseSide();
}
export function prestore(js) { P.scene = JSON.parse(js); P.snap = js; if (!pcur()) P.sel = null; pdraw(); renderPoseSide(); }
export function pundo() { if (!P.undo.length) return; P.redo.push(P.snap); prestore(P.undo.pop()); status("Undo"); }
export function predo() { if (!P.redo.length) return; P.undo.push(P.snap); prestore(P.redo.pop()); status("Redo"); }
