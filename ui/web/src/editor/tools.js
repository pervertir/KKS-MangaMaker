import { act } from "./actions.js";
import { exitAdjust } from "./adjust.js";
import { $, $$, h } from "./core.js";
import { commit, redo, undo } from "./history.js";
import { toggleJobs } from "./jobs.js";
import { layerName } from "./layers.js";
import { layoutDialog } from "./layouts.js";
import { closeMenu } from "./menus.js";
import { status, toast } from "./misc.js";
import { closeModal, modal } from "./modal.js";
import { renderOptions } from "./options.js";
import { gotoPage, pageOps, toggleOverview } from "./pages.js";
import { toggleOrder } from "./panels-tab.js";
import { spaceDown, set_spaceDown } from "./pointer.js";
import { preferencesDialog } from "./preferences.js";
import { exportPages, importDialog, newProject, openDialog, save } from "./project.js";
import { refreshProps } from "./props.js";
import { shotDialog } from "./shots.js";
import { S, layers, selL } from "./state.ts";
import { fitView, requestDraw, requestView, stage, zoomAt } from "./view.js";
import { poseKey, setMode } from "../pose/open.js";
import { scriptWizard } from "../wizard/prompt.js";
import { getTool, onToolsChanged, registeredTools } from "../core/tools.ts";
import { deselect, invertSelection, selectAll } from "../select/tools.ts";

/* ================================================================ tools & keys */
export const ICON = {
  move: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 3l13 7-6 1.5L9 18z" fill="currentColor"/></svg>',
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-.5A6.5 6.5 0 015 17.6L3.4 14a1.6 1.6 0 012.7-1.6L8 15"/></svg>',
  panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="10"/><rect x="13" y="3" width="8" height="6"/><rect x="13" y="11" width="8" height="10"/><rect x="3" y="15" width="8" height="6"/></svg>',
  bubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4c5 0 9 3 9 6.8s-4 6.7-9 6.7c-.9 0-1.8-.1-2.6-.3L5 20l1.1-4C4.2 14.8 3 12.9 3 10.8 3 7 7 4 12 4z"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 5h14M12 5v15M9 20h6"/></svg>',
  sfx: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 5.6 5.8-2-2.8 5.4L22 14l-6 .8.6 6-4.6-3.9L7.4 21l.6-6-6-1 4.8-3L4 5.6l5.8 2z"/></svg>',
  caption: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="10" rx="1"/><path d="M7 12h10"/></svg>',
  vbubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="13" cy="9.5" rx="8.5" ry="6"/><path d="M8 14l-4 7 8-5.5"/><circle cx="21" cy="21" r="1.6" fill="#ff4f7b" stroke="none"/></svg>',
  tone: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="5" r="1.2"/><circle cx="10" cy="5" r="1.2"/><circle cx="15" cy="5" r="1.4"/><circle cx="20" cy="5" r="1.6"/><circle cx="7.5" cy="9.5" r="1.4"/><circle cx="12.5" cy="9.5" r="1.6"/><circle cx="17.5" cy="9.5" r="1.8"/><circle cx="5" cy="14" r="1.6"/><circle cx="10" cy="14" r="1.8"/><circle cx="15" cy="14" r="2"/><circle cx="20" cy="14" r="2.2"/><circle cx="7.5" cy="18.5" r="2"/><circle cx="12.5" cy="18.5" r="2.2"/><circle cx="17.5" cy="18.5" r="2.4"/></svg>',
  speed: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12L2 3l1-1zM12 12L22 3l-1-1zM12 12L2 21l1 1zM12 12l10 9-1 1zM12 12L12 1h.8zM12 12L1 12.4v-.8zM12 12l11 .4v-.8zM12 12l-.4 11h.8z" opacity=".85"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor"/></svg>',
};
export const TONE_PRESETS = [
  ["Dots 30%", { pattern: "dots", size: 10, density: 0.3, angle: 45, fade: "none" }],
  ["Dots 60%", { pattern: "dots", size: 10, density: 0.6, angle: 45, fade: "none" }],
  ["Gradient down", { pattern: "dots", size: 12, density: 0.75, angle: 45, fade: "down" }],
  ["Gradient up", { pattern: "dots", size: 12, density: 0.75, angle: 45, fade: "up" }],
  ["Vignette", { pattern: "dots", size: 12, density: 0.85, angle: 45, fade: "edges" }],
  ["Lines", { pattern: "lines", size: 9, density: 0.35, angle: 0, fade: "none" }],
  ["Diagonal lines", { pattern: "lines", size: 10, density: 0.3, angle: 45, fade: "none" }],
  ["Crosshatch", { pattern: "cross", size: 12, density: 0.22, angle: 45, fade: "none" }],
  ["Sand / noise", { pattern: "noise", size: 10, density: 0.5, angle: 0, fade: "none" }],
  ["Flat grey", { pattern: "solid", size: 4, density: 0.25, angle: 0, fade: "none" }],
  ["Night (dark)", { pattern: "dots", size: 8, density: 0.9, angle: 45, fade: "none" }],
];
export function buildToolbar() {
  const tb = $("#toolbar"); tb.innerHTML = "";
  let group;
  registeredTools().forEach((t, i) => {
    if (i && t.group !== group) tb.append(h("div", { class: "tsep" }));
    group = t.group;
    const b = h("button", { title: t.label + (t.key ? ` (${t.key.toUpperCase()})` : ""), "data-tool": t.id, onclick: () => setTool(t.id) }); b.innerHTML = t.icon; tb.append(b);
  });
  tb.querySelectorAll("button[data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === S.tool));
  tb.append(h("div", { class: "spacer" }), h("button", { title: "Keyboard shortcuts (?)", onclick: shortcutSheet, style: "font-size:13px;font-weight:700" }, "?"));
}
export function setTool(t) {
  if (t === "bubble" && !S.cat?.bubbles?.length) { t = "vbubble"; status("No bubble templates installed: using drawn bubbles"); }
  if (S.tool !== t) { const old = getTool(S.tool); old?.cancel?.(); old?.deactivate?.(); }
  const changed = S.tool !== t;
  S.tool = t; S.polyDraft = null; if (S.adjust) exitAdjust();
  if (changed) getTool(t)?.activate?.();
  $$("#toolbar button").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  renderOptions();
}
/* typing fields keep their keys; sliders, checkboxes, colour wells and dropdowns don't swallow Delete */
export const NONTEXT = ["range", "checkbox", "radio", "color", "button", "submit", "file"];
export const inField = e => {
  const t = e.target;
  if (t.isContentEditable || t.tagName === "TEXTAREA") return true;
  if (t.tagName === "INPUT") return !NONTEXT.includes(t.type);
  if (t.tagName === "SELECT") return !["Delete", "Backspace", "Escape"].includes(e.key);
  return false;
};
/* where the last click was, so Delete removes the right kind of thing: a page in the page strip or
   the book overview, otherwise the selected layer */
export let deleteScope = "layers";
export function deleteSelected() {
  const l = selL();                         // a selected layer always wins; a page only when no layer is selected
  if (!l && (deleteScope === "pages" || !$("#overview").hidden)) return pageOps.del(true);
  if (!l) return status("Nothing selected to delete");
  if (l.locked) return toast("That layer is locked: unlock it first (⌘L)", "err");
  act.remove(); toast(`Deleted ${layerName(l)} — ⌘Z brings it back`);
}
export const center = () => { const r = stage.getBoundingClientRect(); return [r.width / 2, r.height / 2]; };
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
/* One table drives the key handler, the menus' hints and the cheat sheet (press ?).
   Combos: mod = ⌘ on Mac / Ctrl elsewhere; keys are physical (e.code), so Shift/Alt variants still match. */
export const SHORTCUTS = [
  // selection
  ["Select", "mod+a", "Select the whole page", () => selectAll()],
  ["Select", "mod+shift+a", "Deselect", () => deselect()],
  ["Select", "mod+shift+i", "Invert selection", () => invertSelection()],
  // file
  ["File", "mod+n", "New project", () => newProject()],
  ["File", "mod+o", "Open project", () => openDialog(), true],
  ["File", "mod+s", "Save", () => save(), true],
  ["File", "mod+shift+s", "Save as", () => save(true), true],
  ["File", "mod+i", "Import page script", () => importDialog()],
  ["File", "mod+shift+k", "Script Wizard", () => scriptWizard()],
  ["File", "mod+e", "Export this page", () => exportPages("one"), true],
  ["File", "mod+shift+e", "Export all pages + PDF", () => exportPages("all"), true],
  // edit
  ["Edit", "mod+z", "Undo", () => undo()],
  ["Edit", "mod+shift+z", "Redo", () => redo()],
  ["Edit", "mod+y", "Redo", () => redo()],
  ["Edit", "mod+c", "Copy layer", () => act.copy()],
  ["Edit", "mod+x", "Cut layer", () => act.cut()],
  ["Edit", "mod+v", "Paste layer (works across pages)", () => act.paste()],
  ["Edit", "mod+d", "Duplicate layer", () => act.duplicate()],
  ["Edit", "mod+j", "Duplicate layer", () => act.duplicate()],
  ["Edit", "delete", "Delete selected layer (or page, after clicking the page strip)", () => deleteSelected()],
  ["Edit", "backspace", "Delete selected layer (or page, after clicking the page strip)", () => deleteSelected()],
  ["Edit", "escape", "Deselect / leave mode", () => act.escape()],
  ["Edit", "enter", "Type in bubble / reposition render", () => act.enter()],
  ["Edit", "arrows", "Nudge 1 px (Shift: 10 px)", null],
  ["Edit", "mod+,", "Preferences", () => preferencesDialog(), true],
  // layer
  ["Layer", "]", "Bring forward", () => act.layerUp()],
  ["Layer", "[", "Send backward", () => act.layerDown()],
  ["Layer", "shift+]", "Bring to front", () => act.toFront()],
  ["Layer", "shift+[", "Send to back", () => act.toBack()],
  ["Layer", "alt+]", "Select layer above", () => act.selectStep(1)],
  ["Layer", "alt+[", "Select layer below", () => act.selectStep(-1)],
  ["Layer", "f", "Flip (bubble tail, image, panel render)", () => act.flip()],
  ["Layer", "shift+r", "Reset rotation", () => act.resetRotation()],
  ["Layer", "mod+l", "Lock / unlock", () => act.toggleLock()],
  ["Layer", "mod+shift+h", "Hide / show", () => act.toggleHide()],
  ["Layer", "1", "Opacity 10% … 0 = 100%", null],
  ["Layer", "\\", "Split panel side by side", () => act.split("v")],
  ["Layer", "shift+\\", "Split panel top / bottom", () => act.split("h")],
  ["Layer", "alt+\\", "Slanted split side by side", () => act.split("v", 12)],
  ["Layer", "shift+alt+\\", "Slanted split top / bottom", () => act.split("h", -7)],
  ["Layer", "r", "Render the panel's shot on the pod", () => act.renderSel()],
  // page
  ["Page", "pagedown", "Next page", () => gotoPage(S.page + 1)],
  ["Page", ".", "Next page", () => gotoPage(S.page + 1)],
  ["Page", "pageup", "Previous page", () => gotoPage(S.page - 1)],
  ["Page", ",", "Previous page", () => gotoPage(S.page - 1)],
  ["Page", "home", "First page", () => gotoPage(0)],
  ["Page", "end", "Last page", () => gotoPage(S.doc.pages.length - 1)],
  ["Page", "tab", "Whole-book overview", () => toggleOverview()],
  ["Page", "mod+k", "Choose layout", () => layoutDialog()],
  ["Page", "mod+shift+n", "New page", () => pageOps.add()],
  ["Page", "mod+shift+d", "Duplicate page", () => pageOps.dup()],
  ["Page", "mod+shift+backspace", "Delete page", () => pageOps.del()],
  ["Page", "mod+shift+[", "Move page earlier", () => pageOps.left()],
  ["Page", "mod+shift+]", "Move page later", () => pageOps.right()],
  // view
  ["View", "mod+0", "Fit page", () => fitView()],
  ["View", "mod+1", "Actual pixels", () => zoomAt(1 / S.view.s, ...center())],
  ["View", "mod+=", "Zoom in", () => zoomAt(1.25, ...center())],
  ["View", "mod+-", "Zoom out", () => zoomAt(0.8, ...center())],
  ["View", "m", "Show / hide panel order", () => toggleOrder()],
  ["View", ";", "Snapping on / off", () => { S.showGuides = !S.showGuides; renderOptions(); toast("Snapping " + (S.showGuides ? "on" : "off")); }],
  ["View", "space", "Pan while held", null],
  ["View", "mod+;", "Print guides on / off", () => { S.showPrint = !S.showPrint; requestView(); }],
  // pipeline
  ["Pipeline", "mod+u", "Shots (edit, grab, render)", () => shotDialog(selL()?.shot || null)],
  ["Pipeline", "`", "Jobs log", () => toggleJobs()],
  ["Pipeline", "mod+shift+p", "Pose studio", () => setMode(S.mode === "pose" ? "page" : "pose")],
  ["Help", "shift+/", "This cheat sheet", () => shortcutSheet()],
  ["Help", "f1", "This cheat sheet", () => shortcutSheet()],
];
export const CODE_KEY = { BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  Backquote: "`", Equal: "=", Minus: "-", NumpadAdd: "=", NumpadSubtract: "-", Space: "space" };
export function comboOf(e) {
  let key = CODE_KEY[e.code] || (e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.code.startsWith("Digit") ? e.code.slice(5)
    : e.code.startsWith("Numpad") && /\d$/.test(e.code) ? e.code.slice(-1) : e.key.toLowerCase());
  const SHIFTED = { "+": "=", "?": "/", "{": "[", "}": "]", "|": "\\", ":": ";", "<": ",", ">": ".", "~": "`", "_": "-" };
  if (SHIFTED[key]) key = SHIFTED[key];   // when the browser gives no physical code
  return (e.metaKey || e.ctrlKey ? "mod+" : "") + (e.shiftKey ? "shift+" : "") + (e.altKey ? "alt+" : "") + key;
}
export const SC_MAP = new Map(SHORTCUTS.filter(r => r[3]).map(r => [r[1], r]));
export function keyLabel(combo) {
  const parts = combo.split("+"), key = parts.pop();
  const names = { mod: isMac ? "⌘" : "Ctrl+", shift: isMac ? "⇧" : "Shift+", alt: isMac ? "⌥" : "Alt+" };
  const keys = { escape: "Esc", enter: "↵", backspace: "⌫", delete: "Del", pagedown: "PgDn", pageup: "PgUp", tab: "Tab", space: "Space",
    home: "Home", end: "End", arrows: "← ↑ → ↓", f1: "F1", "=": "+", "/": "/" };
  return parts.map(p => names[p]).join("") + (keys[key] || key.toUpperCase());
}
export const sc = label => { const r = SHORTCUTS.find(r => r[2] === label); return r ? keyLabel(r[1]) : ""; };
export function shortcutSheet() {
  const box = modal("Keyboard shortcuts", "");
  const groups = {};
  const toolRows = registeredTools().filter(t => t.key).map(t => ["Tools", t.key, t.label]);
  for (const [g, k, label] of [...toolRows, ...SHORTCUTS]) {
    const list = (groups[g] ||= []);
    const prev = list.find(x => x.label === label);
    if (prev) prev.keys.push(keyLabel(k)); else list.push({ label, keys: [keyLabel(k)] });
  }
  const grid = h("div", { class: "scgrid" });
  for (const [g, rows] of Object.entries(groups)) grid.append(h("div", { class: "scgroup" }, h("h4", {}, g),
    ...rows.map(r => h("div", { class: "scrow" }, h("span", {}, r.label), h("span", {}, ...r.keys.flatMap((k, i) => [i ? " / " : "", h("kbd", {}, k)]))))));
  $(".mbody", box).append(grid, h("p", { class: "hint" }, "Mouse: drag to move · Alt-drag duplicates · ⌘-click picks the panel under a bubble · Shift locks axis / keeps aspect · " +
    "Ctrl while dragging disables snapping · double-click a panel to reposition its render, a bubble to type · Ctrl/⌘ + scroll zooms."));
}

export function set_setTool(v) { setTool = v; }

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_tools() {
  document.addEventListener("pointerdown", e => {
    deleteScope = e.target.closest("#pagenav, #overview") ? "pages" : e.target.closest("#stage, #layers, #panels, #paneltools, .panefoot, #props, #toolbar") ? "layers" : deleteScope;
  }, true);

  document.addEventListener("keydown", e => {
    if (S.mode === "pose" && $("#modal").hidden) return poseKey(e);
    const combo = comboOf(e), row = SC_MAP.get(combo);
    const modalOpen = !$("#modal").hidden;
    if (modalOpen || inField(e)) {
      if (e.key === "Escape" && modalOpen) { e.preventDefault(); closeModal(); }
      else if (row?.[4] && !modalOpen) { e.preventDefault(); row[3](); }      // save/export/open still work while typing
      return;
    }
    if (combo === "space" || combo === "shift+space") { if (!spaceDown) { set_spaceDown(true); stage.classList.add("hand"); } e.preventDefault(); return; }
    if (e.key.startsWith("Arrow") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const l = selL(); if (!l || l.locked) return; e.preventDefault();
      const n = e.shiftKey ? 10 : 1;
      l.x += e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0; l.y += e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
      for (const q of layers()) if (q.clip === l.id) { q.x += e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0; q.y += e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0; }
      clearTimeout(S.nudgeT); S.nudgeT = setTimeout(() => commit("Nudged"), 300); requestDraw(); refreshProps(true); return;
    }
    if (/^[0-9]$/.test(combo)) {   // Photoshop-style opacity: 1 = 10% … 0 = 100%
      const l = selL(); if (!l) return; e.preventDefault();
      l.opacity = combo === "0" ? 1 : +combo / 10; commit(`Opacity ${Math.round(l.opacity * 100)}%`); requestDraw(); return;
    }
    const active = getTool(S.tool);
    if (e.key === "Escape" && active?.cancel) { active.cancel(); requestDraw(); }
    if (active?.keydown?.(e)) { e.preventDefault(); requestDraw(); return; }
    if (row) { e.preventDefault(); closeMenu(); row[3](); return; }
    const own = registeredTools().find(t => t.key && t.key === combo);
    if (own) { e.preventDefault(); setTool(own.id); }
  });
  onToolsChanged(() => { if (document.getElementById("toolbar")?.childElementCount) buildToolbar(); });

  document.addEventListener("keyup", e => { if (e.key === " ") { set_spaceDown(false); stage.classList.toggle("hand", S.tool === "hand"); } });
}
