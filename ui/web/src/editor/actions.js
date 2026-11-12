import { enterAdjust, exitAdjust } from "./adjust.js";
import { $, clamp, deep, uid } from "./core.js";
import { insertIndexForPanel } from "./creation.js";
import { commit } from "./history.js";
import { showInline } from "./inline-edit.js";
import { renderShot, toggleJobs } from "./jobs.js";
import { layerName } from "./layers.js";
import { refreshPanels, status, toast } from "./misc.js";
import { toggleOverview } from "./pages.js";
import { S, layers, selL } from "./state.js";
import { deleteSelected, setTool } from "./tools.js";
import { requestDraw, requestView } from "./view.js";

import { ui } from "../ui/store.svelte.js";

/* ================================================================ actions */
export const act = {
  copy() { const l = selL(); if (!l) return; S.clip = deep(l); status("Copied " + layerName(l)); },
  cut() { const l = selL(); if (!l) return; S.clip = deep(l); act.remove(); status("Cut"); },
  paste() {
    if (!S.clip) return;
    const c = deep(S.clip); c.id = uid();
    if (layers().some(q => q.id === S.clip.id)) { c.x += 30; c.y += 30; }   // same page: offset so it is visible
    if (c.clip && !layers().some(q => q.id === c.clip)) c.clip = null;
    if (c.type === "panel") layers().splice(insertIndexForPanel(), 0, c); else layers().push(c);
    S.sel = c.id; S.clip = deep(c); commit("Pasted"); requestDraw();
  },
  escape() {
    if (!$("#overview").hidden) return toggleOverview(false);
    if (ui.jobsOpen && !selL()) return toggleJobs(false);
    if (S.adjust) return exitAdjust();
    if (S.tool !== "move") return setTool("move");
    S.sel = null; refreshPanels(); requestView();
  },
  enter() {
    const l = selL();
    if (l?.type === "panel" && l.image) enterAdjust(l);
    else if (l && ["bubble", "caption", "text", "vbubble"].includes(l.type)) showInline(l);
  },
  selectStep(dir) {
    const ls = layers(); if (!ls.length) return;
    const i = selL() ? ls.indexOf(selL()) : dir > 0 ? -1 : ls.length;
    S.sel = ls[clamp(i + dir, 0, ls.length - 1)].id; refreshPanels(); requestView();
  },
  flip() {
    const l = selL(); if (!l) return;
    if (l.type === "panel") { if (!l.image) return; l.image.flip = !l.image.flip; }
    else if (l.type === "vbubble") { if (!l.tail) return; l.tail = { x: -l.tail.x, y: l.tail.y }; }
    else l.flip = !l.flip;
    commit("Flipped"); requestDraw();
  },
  resetRotation() { const l = selL(); if (!l || !l.rotate) return; l.rotate = 0; commit("Rotation reset"); requestDraw(); },
  lockPanels(on) { const ps = layers().filter(l => l.type === "panel"); ps.forEach(l => l.locked = on); commit(`${ps.length} panel${ps.length === 1 ? "" : "s"} ${on ? "locked" : "unlocked"}`); refreshPanels(); requestView(); },
  toggleLock() { const l = selL(); if (!l) return; l.locked = !l.locked; commit(l.locked ? "Locked" : "Unlocked"); requestView(); },
  toggleHide() { const l = selL(); if (!l) return; l.visible = !l.visible; commit(l.visible ? "Shown" : "Hidden"); requestDraw(); },
  renderSel() { const l = selL(); if (l?.type === "panel" && l.shot) renderShot(l.shot); else toast("Select a panel that has a shot"); },
  remove() {
    const l = selL(); if (!l) return; layers().splice(layers().indexOf(l), 1);
    for (const q of layers()) if (q.clip === l.id) q.clip = null;
    S.sel = null; commit("Deleted"); requestDraw();
  },
  duplicate() {
    const l = selL(); if (!l) return; const c = deep(l); c.id = uid(); if (!c.clip) { c.x += 30; c.y += 30; }
    layers().splice(layers().indexOf(l) + 1, 0, c); S.sel = c.id; commit("Duplicated"); requestDraw();
  },
  layerUp() { const ls = layers(), l = selL(); if (!l) return; const i = ls.indexOf(l); if (i < ls.length - 1) { ls.splice(i, 1); ls.splice(i + 1, 0, l); commit("Moved up"); requestDraw(); } },
  layerDown() { const ls = layers(), l = selL(); if (!l) return; const i = ls.indexOf(l); if (i > 0) { ls.splice(i, 1); ls.splice(i - 1, 0, l); commit("Moved down"); requestDraw(); } },
  toFront() { const ls = layers(), l = selL(); if (!l) return; ls.splice(ls.indexOf(l), 1); ls.push(l); commit("To front"); requestDraw(); },
  toBack() { const ls = layers(), l = selL(); if (!l) return; ls.splice(ls.indexOf(l), 1); ls.unshift(l); commit("To back"); requestDraw(); },
  split(dir) {
    const l = selL(); if (!l || l.type !== "panel") return;
    const g = 30 + l.border, b = deep(l); b.id = uid(); b.image = null; b.shot = "";
    if (dir === "v") { const w = (l.w - g) / 2; l.w = w; b.x = l.x + w + g; b.w = w; }
    else { const hh = (l.h - g) / 2; l.h = hh; b.y = l.y + hh + g; b.h = hh; }
    layers().splice(layers().indexOf(l) + 1, 0, b); commit("Split panel"); requestDraw();
  },
};

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_actions() {

  document.addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b && act[b.dataset.act]) act[b.dataset.act](); });
}
