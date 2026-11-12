import { $, $$ } from "./core.js";
import { renderLibrary } from "./library.js";
import { S, selL } from "./state.ts";
import { ui } from "../ui/store.svelte.ts";

/* ================================================================ dock tabs */
export const DOCKTABS = ["layers", "panels", "library"];
export function setDockTab(t, byHand) {
  if (!DOCKTABS.includes(t)) t = "panels";
  S.dockTab = t;
  if (byHand) try { localStorage.setItem("mm.dock.tab", t); } catch { }      // only a choice made by hand is remembered
  ui.dockTab = t;                                  // src/ui/Dock.svelte shows the tab
  if (t !== "library") requestAnimationFrame(() => $("#" + t + " .on")?.scrollIntoView({ block: "nearest" }));
}
/* open a Library category, wherever the dock is: "Pick bubble…" must not look like it did nothing */
export function showLib(tab) { S.libTab = tab; setDockTab("library"); renderLibrary(); }
/* Picking something on the page brings its list forward (a frame: Panels, anything else: Layers). The
   Library is never taken away, and a pick made inside the dock leaves the tab where the hand is. */
export let dockPress = false, followed = null;
export function followSel() {
  if (S.sel === followed) return;
  followed = S.sel;
  const l = selL(); if (!l || dockPress || S.dockTab === "library") return;
  const want = l.type === "panel" ? "panels" : "layers";
  if (want !== S.dockTab) setDockTab(want);
}

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_dock_tabs() {
  document.addEventListener("pointerdown", e => { dockPress = !!e.target.closest("#dock"); }, true);
}
