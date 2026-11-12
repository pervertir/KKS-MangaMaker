import { refreshPanels, status } from "./misc.js";
import { renderPages } from "./pages.js";
import { S, selL } from "./state.js";
import { requestDraw } from "./view.js";

/* ================================================================ history */
export function commit(msg) {
  S.undo.push(S.snap); if (S.undo.length > 150) S.undo.shift();
  S.redo = []; snapshot(); S.dirty = true; refreshPanels(); if (msg) status(msg);
}
export function snapshot() { S.snap = JSON.stringify({ doc: S.doc, page: S.page }); }
export function restore(js) {
  const o = JSON.parse(js); S.doc = o.doc; S.page = Math.min(o.page, S.doc.pages.length - 1);
  if (!selL()) S.sel = null; snapshot(); S.dirty = true; requestDraw(); refreshPanels(); renderPages();
}
export function undo() { if (!S.undo.length) return; S.redo.push(S.snap); restore(S.undo.pop()); status("Undo"); }
export function redo() { if (!S.redo.length) return; S.undo.push(S.snap); restore(S.redo.pop()); status("Redo"); }
