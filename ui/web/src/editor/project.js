import { $, api, h, post, uid } from "./core.js";
import { snapshot } from "./history.js";
import { waitImages } from "./images.js";
import { layoutDialog } from "./layouts.js";
import { drawPage } from "./manga-tools.js";
import { refreshPanels, status, toast } from "./misc.js";
import { closeModal, modal } from "./modal.js";
import { renderPages } from "./pages.js";
import { H, S, W, newDoc, normalize } from "./state.ts";
import { fitView } from "./view.js";

/* ================================================================ save / open / export */
export function setName(n) { S.name = n; $("#docname").textContent = n ? `${n}${S.dirty ? " •" : ""}` : "unsaved"; document.title = (n || "Untitled") + " — MangaMaker"; }
export async function save(as) {
  let n = S.name;
  if (!n || as) { n = prompt("Project name (saved to MangaPipeline/pages/<name>/project.json)", n || S.doc.title.replace(/[^\w\- .]/g, "_")); if (!n) return; }
  try { await post(`/api/project?name=${encodeURIComponent(n)}`, S.doc); S.dirty = false; setName(n); toast("Saved " + n, "ok"); localStorage.setItem("mm.last", n); }
  catch (e) { toast(e.message, "err"); }
}
export async function openProject(n) {
  try {
    const doc = await api(`/api/project?name=${encodeURIComponent(n)}`);
    loadDoc(normalize(doc), n); localStorage.setItem("mm.last", n);
  } catch (e) { toast(e.message, "err"); }
}
export function loadDoc(doc, name) {
  S.doc = doc; S.page = 0; S.sel = null; S.undo = []; S.redo = []; S.adjust = null; snapshot(); S.dirty = false;
  setName(name || ""); refreshPanels(); renderPages(); fitView(); status("");
}
export function newProject() {
  if (S.dirty && !confirm("Discard unsaved changes?")) return;
  loadDoc(newDoc(), ""); layoutDialog();
}
export async function openDialog() {
  const ps = await api("/api/projects").catch(() => []);
  const box = modal("Open project", "small");
  const body = $(".mbody", box);
  if (!ps.length) body.append(h("p", { class: "hint" }, "No saved projects yet."));
  for (const p of ps) body.append(h("div", { class: "row" }, h("button", { style: "flex:1;text-align:left", onclick: () => { closeModal(); openProject(p); } }, p)));
}
export async function importDialog() {
  const box = modal("Import a page script", "small"), body = $(".mbody", box);
  body.append(h("p", { class: "hint" }, "Turns a scripts/*.yaml (the one `mangapipe page` builds) into an editable project: layouts, renders, crops and dialogue."));
  for (const sc of S.cat.scripts) body.append(h("div", { class: "row" }, h("button", { style: "flex:1;text-align:left", onclick: async () => {
    try {
      const d = await post(`/api/import?script=${encodeURIComponent(sc)}`);
      const doc = normalize({ ...newDoc(d.title), ...d, pages: d.pages.map(p => ({ id: uid(), bg: "#ffffff", layers: p.layers })) });
      closeModal(); loadDoc(doc, ""); toast(`Imported ${sc}`, "ok");
    } catch (e) { toast(e.message, "err"); }
  } }, sc)));
}
export async function renderFull(i) {
  const c = document.createElement("canvas"); c.width = W(); c.height = H();
  const g = c.getContext("2d");
  await document.fonts.ready;
  for (let k = 0; k < 3; k++) { drawPage(g, S.doc.pages[i], { export: true, rs: 1 }); await waitImages(); }
  drawPage(g, S.doc.pages[i], { export: true, rs: 1 });
  return c;
}
export async function exportPages(which) {
  if (!S.name) { await save(); if (!S.name) return; }
  const idx = which === "all" ? S.doc.pages.map((_, i) => i) : [S.page];
  status("Exporting…");
  try {
    for (const i of idx) {
      const c = await renderFull(i);
      const blob = await new Promise(r => c.toBlob(r, "image/png"));
      await post(`/api/export/page?name=${encodeURIComponent(S.name)}&n=${i + 1}`, blob, true);
    }
    let msg = `Exported ${idx.length} page${idx.length > 1 ? "s" : ""} to pages/${S.name}/`;
    if (which === "all") { await post(`/api/export/pdf?name=${encodeURIComponent(S.name)}&count=${S.doc.pages.length}`); msg += ` + ${S.name}.pdf`; }
    toast(msg, "ok"); status(msg);
  } catch (e) { toast(e.message, "err"); }
}
export async function downloadPage() {
  const c = await renderFull(S.page);
  const a = h("a", { href: c.toDataURL("image/png"), download: `${S.name || "page"}_${String(S.page + 1).padStart(2, "0")}.png` }); a.click();
}

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_project() {
  setInterval(() => { if (S.doc && S.dirty) try { localStorage.setItem("mm.autosave", JSON.stringify({ name: S.name, doc: S.doc })); } catch { } }, 5000);

  addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
}
