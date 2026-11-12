import { act } from "./actions.js";
import { $, h } from "./core.js";
import { redo, undo } from "./history.js";
import { podAction, refreshPod, toggleJobs } from "./jobs.js";
import { layoutDialog } from "./layouts.js";
import { toast } from "./misc.js";
import { renderOptions } from "./options.js";
import { gotoPage, pageMenu, toggleOverview } from "./pages.js";
import { toggleOrder } from "./panels-tab.js";
import { preferencesDialog } from "./preferences.js";
import { exportBookDialog } from "./export-book.js";
import { downloadPage, exportPages, importDialog, newProject, openDialog, save } from "./project.js";
import { shotDialog } from "./shots.js";
import { S, selL } from "./state.ts";
import { center, sc, shortcutSheet } from "./tools.js";
import { fitView, requestView, zoomAt } from "./view.js";
import { poseForPanel, setMode } from "../pose/open.js";
import { scriptWizard } from "../wizard/prompt.js";
import { saveSelectionDialog } from "../assets/dialogs.ts";

/* ================================================================ menus */
export const MENUS = {
  File: () => [["New project", newProject, sc("New project")], ["Script Wizard…", () => scriptWizard(), sc("Script Wizard")], ["Open…", openDialog, sc("Open project")], ["Save", () => save(), sc("Save")], ["Save as…", () => save(true), sc("Save as")], null,
    ["Import page script…", importDialog, sc("Import page script")], null, ["Export this page (PNG)", () => exportPages("one"), sc("Export this page")],
    ["Export all pages + PDF", () => exportPages("all"), sc("Export all pages + PDF")],
    ["Export book (webtoon, CBZ, EPUB, print)…", exportBookDialog, sc("Export book (webtoon, CBZ, EPUB, print)")], ["Download this page", downloadPage]],
  Edit: () => [["Undo", undo, sc("Undo"), !S.undo.length], ["Redo", redo, sc("Redo"), !S.redo.length], null,
    ["Cut", act.cut, sc("Cut layer"), !selL()], ["Copy", act.copy, sc("Copy layer"), !selL()], ["Paste", act.paste, sc("Paste layer (works across pages)"), !S.clip],
    ["Duplicate", act.duplicate, sc("Duplicate layer"), !selL()], ["Delete", act.remove, "Del", !selL()], null,
    ["Save to asset library…", saveSelectionDialog, "", !selL()], null,
    ["Deselect", act.escape, "Esc"], ["Keyboard shortcuts", shortcutSheet, "?"], null, ["Preferences…", preferencesDialog, sc("Preferences")]],
  Layer: () => [["Bring forward", act.layerUp, sc("Bring forward")], ["Send backward", act.layerDown, sc("Send backward")],
    ["Bring to front", act.toFront, sc("Bring to front")], ["Send to back", act.toBack, sc("Send to back")], null,
    ["Select layer above", () => act.selectStep(1), sc("Select layer above")], ["Select layer below", () => act.selectStep(-1), sc("Select layer below")], null,
    ["Flip", act.flip, sc("Flip (bubble tail, image, panel render)"), !selL()], ["Reset rotation", act.resetRotation, sc("Reset rotation"), !selL()?.rotate],
    ["Lock / unlock", act.toggleLock, sc("Lock / unlock"), !selL()], ["Lock all panels", () => act.lockPanels(true)], ["Unlock all panels", () => act.lockPanels(false)], ["Hide / show", act.toggleHide, sc("Hide / show"), !selL()], null,
    ["Split panel ⇆", () => act.split("v"), sc("Split panel side by side"), selL()?.type !== "panel"], ["Split panel ⇅", () => act.split("h"), sc("Split panel top / bottom"), selL()?.type !== "panel"],
    ["Reposition render", act.enter, "↵", !(selL()?.image)], ["Render shot on pod", act.renderSel, sc("Render the panel's shot on the pod"), !selL()?.shot]],
  Page: () => [["Whole-book overview", () => toggleOverview(true), sc("Whole-book overview")], ["Next page", () => gotoPage(S.page + 1), sc("Next page")],
    ["Previous page", () => gotoPage(S.page - 1), sc("Previous page")], ["First page", () => gotoPage(0), "Home"], ["Last page", () => gotoPage(S.doc.pages.length - 1), "End"], null,
    ["Choose layout…", layoutDialog, sc("Choose layout")], null, ...pageMenu()],
  View: () => [["Fit page", fitView, sc("Fit page")], ["Actual pixels", () => zoomAt(1 / S.view.s, ...center()), sc("Actual pixels")],
    ["Zoom in", () => zoomAt(1.25, ...center()), sc("Zoom in")], ["Zoom out", () => zoomAt(0.8, ...center()), sc("Zoom out")], null,
    [(S.showOrder ? "Hide" : "Show") + " panel order", () => toggleOrder(), sc("Show / hide panel order")],
    [(S.showGuides ? "Disable" : "Enable") + " snapping", () => { S.showGuides = !S.showGuides; renderOptions(); }, sc("Snapping on / off")],
    [(S.showPrint ? "Hide" : "Show") + " print guides (trim / safe area)", () => { S.showPrint = !S.showPrint; requestView(); }, sc("Print guides on / off")]],
  Pipeline: () => [["Pose studio", () => setMode("pose"), sc("Pose studio")], ["Pose the selected panel…", () => poseForPanel(selL()), "", selL()?.type !== "panel"], null, ["Shots…", () => shotDialog(selL()?.shot || null), sc("Shots (edit, grab, render)")], ["New shot…", () => shotDialog(null, true)], null,
    ["Pod status", () => refreshPod(true)], ["Open ComfyUI on the pod", () => S.pod?.url ? window.open(S.pod.url, "_blank") : toast("Pod URL unknown"), "", !S.pod?.url],
    ["Start pod", () => podAction("start")], ["Stop pod (ends GPU billing)", () => podAction("stop")], null, ["Jobs", () => toggleJobs(true), sc("Jobs log")]],
  Help: () => [["Keyboard shortcuts", shortcutSheet, "?"]],
};
export function buildMenus() {
  const m = $("#menus"); m.innerHTML = "";
  for (const k of Object.keys(MENUS)) m.append(h("button", { onclick: e => { const r = e.target.getBoundingClientRect(); popMenu(r.left, r.bottom + 2, MENUS[k]()); } }, k));
}
export function popMenu(x, y, items) {
  const pop = $("#menu-pop"); pop.innerHTML = "";
  for (const it of items) {
    if (!it) { pop.append(h("hr")); continue; }
    const [t, fn, key, dis] = it;
    pop.append(h("div", { class: "mi" + (dis ? " dis" : ""), onclick: () => { closeMenu(); fn(); } }, h("span", {}, t), h("span", { class: "k" }, key || "")));
  }
  pop.hidden = false; pop.style.left = x + "px"; pop.style.top = y + "px";
  const r = pop.getBoundingClientRect(); if (r.right > innerWidth) pop.style.left = innerWidth - r.width - 8 + "px"; if (r.bottom > innerHeight) pop.style.top = innerHeight - r.height - 8 + "px";
  setTimeout(() => document.addEventListener("pointerdown", outside), 0);
}
export function outside(e) { if (!e.target.closest("#menu-pop")) closeMenu(); }
export function closeMenu() { $("#menu-pop").hidden = true; document.removeEventListener("pointerdown", outside); }
