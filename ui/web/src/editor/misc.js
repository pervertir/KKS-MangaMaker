import { $, h } from "./core.js";
import { followSel } from "./dock-tabs.js";
import { renderLayers } from "./layers.js";
import { schedThumbs } from "./pages.js";
import { renderPanelsTab } from "./panels-tab.js";
import { setName } from "./project.js";
import { refreshProps } from "./props.js";
import { S } from "./state.js";
import { resize, stage } from "./view.js";
import { ui } from "../ui/store.svelte.js";

/* ================================================================ misc */
export function refreshPanels() { refreshProps(); renderLayers(); renderPanelsTab(); followSel(); setName(S.name); schedThumbs(); }
export function status(m) { $("#st-msg").textContent = m || ""; }
let toastId = 0;
export function toast(m, kind) {
  const id = ++toastId;
  ui.toasts.push({ id, text: String(m), kind: kind || "" });
  setTimeout(() => { const i = ui.toasts.findIndex(t => t.id === id); if (i >= 0) ui.toasts.splice(i, 1); }, kind === "err" ? 6000 : 3000);
}

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_misc() {
  new ResizeObserver(resize).observe(stage);
}
