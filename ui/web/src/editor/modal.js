import { $, h } from "./core.js";

/* ================================================================ modal */
export function modal(title, cls) {
  const box = $("#modalbox"); dropContent(box); box.className = cls || ""; box.innerHTML = "";
  box.append(h("div", { class: "mhead" }, title, h("button", { class: "ghost", onclick: closeModal }, "✕")), h("div", { class: "mbody" }));
  $("#modal").hidden = false;
  return box;
}
/* a dialog whose content is a mounted component (src/ui/mount.js) is unmounted when it goes away */
function dropContent(box) { const u = box._unmount; box._unmount = null; if (u) u(); }
export function closeModal() { $("#modal").hidden = true; dropContent($("#modalbox")); }

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_modal() {
  $("#modal").addEventListener("pointerdown", e => { if (e.target.id === "modal") closeModal(); });
}
