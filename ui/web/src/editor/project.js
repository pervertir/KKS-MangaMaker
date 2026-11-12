import { $, api, h, post, uid } from "./core.js";
import { snapshot } from "./history.js";
import { waitImages } from "./images.js";
import { layoutDialog } from "./layouts.js";
import { drawPage } from "./manga-tools.js";
import { refreshPanels, status, toast } from "./misc.js";
import { closeModal, modal } from "./modal.js";
import { renderPages } from "./pages.js";
import { bleedPx, halves, pageWidth, slotCount, slotOf } from "./book.ts";
import { H, S, newDoc, normalize } from "./state.ts";
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
  const c = document.createElement("canvas"); c.width = Math.round(pageWidth(S.doc, S.doc.pages[i])); c.height = H();
  const g = c.getContext("2d");
  await document.fonts.ready;
  for (let k = 0; k < 3; k++) { drawPage(g, S.doc.pages[i], { export: true, rs: 1 }); await waitImages(); }
  drawPage(g, S.doc.pages[i], { export: true, rs: 1 });
  return c;
}
/* a region of a rendered page, cut to the trim unless the format keeps the bleed */
function cut(src, r) {
  const b = S.doc.format.exportBleed ? 0 : bleedPx(S.doc);
  const x0 = r.x + b, x1 = r.x + r.w - b, y0 = r.y + b, y1 = r.y + r.h - b;
  const c = document.createElement("canvas"); c.width = Math.round(x1 - x0); c.height = Math.round(y1 - y0);
  c.getContext("2d").drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c;
}
const pngOf = c => new Promise(r => c.toBlob(r, "image/png"));
export async function exportPages(which) {
  if (!S.name) { await save(); if (!S.name) return; }
  const idx = which === "all" ? S.doc.pages.map((_, i) => i) : [S.page];
  const q = `name=${encodeURIComponent(S.name)}`;
  status("Exporting…");
  try {
    let files = 0;
    for (const i of idx) {
      const c = await renderFull(i), pg = S.doc.pages[i];
      for (const hf of halves(S.doc, i)) {
        await post(`/api/export/page?${q}&n=${hf.slot}`, await pngOf(cut(c, hf.rect)), true); files++;
      }
      if (pg.span === 2) await post(`/api/export/page?${q}&n=${slotOf(S.doc, i)}&spread=1`, await pngOf(cut(c, { x: 0, y: 0, w: c.width, h: c.height })), true);
    }
    let msg = `Exported ${files} page${files > 1 ? "s" : ""} to pages/${S.name}/`;
    if (which === "all") { await post(`/api/export/pdf?${q}&count=${slotCount(S.doc)}&dpi=${S.doc.format.dpi}`); msg += ` + ${S.name}.pdf`; }
    toast(msg, "ok"); status(msg);
  } catch (e) { toast(e.message, "err"); }
}
export async function downloadPage() {
  const c = await renderFull(S.page), out = cut(c, { x: 0, y: 0, w: c.width, h: c.height });
  const a = h("a", { href: out.toDataURL("image/png"), download: `${S.name || "page"}_${String(slotOf(S.doc, S.page)).padStart(2, "0")}.png` }); a.click();
}

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_project() {
  setInterval(() => { if (S.doc && S.dirty) try { localStorage.setItem("mm.autosave", JSON.stringify({ name: S.name, doc: S.doc })); } catch { } }, 5000);

  addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
}
