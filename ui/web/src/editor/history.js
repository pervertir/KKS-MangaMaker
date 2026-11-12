import { refreshPanels, status } from "./misc.js";
import { renderPages } from "./pages.js";
import { S, page, selL } from "./state.ts";
import { derivePage } from "./knife.js";
import { requestDraw } from "./view.js";
import * as H from "../core/history.ts";

/* ================================================================ history */
/* Each commit records only what changed since the last one (core/history.ts), so a step costs bytes, not the
   whole book. S.undo / S.redo hold the steps; replacing them with [] clears the history. */
const hist = H.createHistory();
const sync = () => { hist.undo = S.undo; hist.redo = S.redo; };

function bumpRevs(paths) {
  const base = hist.base;
  for (const p of paths) {
    if (p[0] !== "pages" || typeof p[1] !== "number" || p[2] !== "layers") continue;
    const ls = S.doc.pages[p[1]]?.layers;
    if (!ls) continue;
    if (typeof p[3] === "number") { if (ls[p[3]]) ls[p[3]].rev = (ls[p[3]].rev || 0) + 1; continue; }
    const before = new Map((base?.pages?.[p[1]]?.layers || []).map(l => [l.id, JSON.stringify(l)]));
    for (const l of ls) if (before.get(l.id) !== JSON.stringify(l)) l.rev = (l.rev || 0) + 1;
  }
}

export function commit(msg) {
  if (S.doc) derivePage(page());
  sync();
  H.commit(hist, S.doc, S.page, msg || "", undefined, bumpRevs);
  S.dirty = true; refreshPanels(); if (msg) status(msg);
}
/** Commits an edit whose data lives outside the document (painted tiles, blobs): `step.undo()` / `step.redo()`
 *  put that data back, `step.bytes` counts against the 512 MB history budget. Any document change made with it
 *  (a layer's bounds, a new blob id) goes into the same undo step. */
export function pushStep(msg, step) {
  sync();
  H.commit(hist, S.doc, S.page, msg || "", step, bumpRevs);
  S.dirty = true; refreshPanels(); if (msg) status(msg);
}
export function snapshot() { H.reset(hist, S.doc, S.page); }
function moveTo(r, label) {
  S.doc = r.doc; S.page = Math.min(r.page, S.doc.pages.length - 1);
  if (!selL()) S.sel = null;
  S.dirty = true; requestDraw(); refreshPanels(); renderPages(); status(label);
}
export function undo() { sync(); const r = H.undo(hist, S.doc); if (r) moveTo(r, "Undo" + (r.step.label ? ": " + r.step.label : "")); }
export function redo() { sync(); const r = H.redo(hist, S.doc); if (r) moveTo(r, "Redo" + (r.step.label ? ": " + r.step.label : "")); }
