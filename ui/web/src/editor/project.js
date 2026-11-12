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
import { uploadBlobs } from "../core/blobs.ts";
import { planBands } from "../core/bands.ts";
import { clearAutosave, writeAutosave } from "../core/autosave.ts";

/* ================================================================ save / open / export */
export function setName(n) { S.name = n; $("#docname").textContent = n ? `${n}${S.dirty ? " •" : ""}` : "unsaved"; document.title = (n || "Untitled") + " — MangaMaker"; }
export async function save(as) {
  let n = S.name;
  if (!n || as) { n = prompt("Project name (saved to MangaPipeline/pages/<name>/project.json)", n || S.doc.title.replace(/[^\w\- .]/g, "_")); if (!n) return; }
  try { await uploadBlobs(n, S.doc); await post(`/api/project?name=${encodeURIComponent(n)}`, S.doc); S.dirty = false; clearAutosave(); setName(n); toast("Saved " + n, "ok"); localStorage.setItem("mm.last", n); }
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
  const t = trimmed(r);
  const c = document.createElement("canvas"); c.width = Math.round(t.w); c.height = Math.round(t.h);
  c.getContext("2d").drawImage(src, t.x, t.y, t.w, t.h, 0, 0, c.width, c.height);
  return c;
}
function trimmed(r, keepBleed = false) {
  const b = keepBleed || S.doc.format.exportBleed ? 0 : bleedPx(S.doc);
  return { x: r.x + b, y: r.y + b, w: r.w - 2 * b, h: r.h - 2 * b };
}
const pngOf = c => new Promise(r => c.toBlob(r, "image/png"));
/* rows [y, y + h) of the area r of page i, at `scale` canvas px per page px */
export async function renderBand(i, y, h, scale = 1, r = { x: 0, y: 0, w: pageWidth(S.doc, S.doc.pages[i]), h: H() }) {
  const c = document.createElement("canvas"); c.width = Math.round(r.w * scale); c.height = h;
  const g = c.getContext("2d");
  await document.fonts.ready;
  const paint = () => { g.setTransform(scale, 0, 0, scale, -r.x * scale, -r.y * scale - y); drawPage(g, S.doc.pages[i], { export: true, rs: scale }); };
  for (let k = 0; k < 3; k++) { paint(); await waitImages(); }
  paint();
  return c;
}
/* sends the area r of page i to url, in bands when it is too big for one canvas */
async function uploadArea(url, i, r, scale = 1) {
  const bands = planBands(Math.round(r.w * scale), Math.round(r.h * scale));
  if (bands.length === 1) return post(url, await pngOf(await renderBand(i, 0, bands[0].h, scale, r)), true);
  for (const [k, b] of bands.entries()) await post(`${url}&band=${k}&bands=${bands.length}`, await pngOf(await renderBand(i, b.y, b.h, scale, r)), true);
}
export async function uploadPage(i, scale = 1) {
  return uploadArea(`/api/export/page?name=${encodeURIComponent(S.name)}&n=${i + 1}`, i, { x: 0, y: 0, w: pageWidth(S.doc, S.doc.pages[i]), h: H() }, scale);
}
/* renders and uploads pages idx: one file per page slot (both halves of a spread), plus the whole spread;
   the book export keeps the bleed for the print PDF */
async function uploadPages(idx, keepBleed = false) {
  const q = `name=${encodeURIComponent(S.name)}`;
  let files = 0;
  for (const i of idx) {
    status(`Exporting page ${i + 1} of ${S.doc.pages.length}…`);
    const pg = S.doc.pages[i];
    for (const hf of halves(S.doc, i)) { await uploadArea(`/api/export/page?${q}&n=${hf.slot}`, i, trimmed(hf.rect, keepBleed)); files++; }
    if (pg.span === 2) await uploadArea(`/api/export/page?${q}&n=${slotOf(S.doc, i)}&spread=1`, i, trimmed({ x: 0, y: 0, w: pageWidth(S.doc, pg), h: H() }, keepBleed));
  }
  return files;
}
export async function exportPages(which) {
  if (!S.name) { await save(); if (!S.name) return; }
  const idx = which === "all" ? S.doc.pages.map((_, i) => i) : [S.page];
  const q = `name=${encodeURIComponent(S.name)}`;
  status("Exporting…");
  try {
    const files = await uploadPages(idx);
    let msg = `Exported ${files} page${files > 1 ? "s" : ""} to pages/${S.name}/`;
    if (which === "all") { await post(`/api/export/pdf?${q}&count=${slotCount(S.doc)}&dpi=${S.doc.format.dpi}`); msg += ` + ${S.name}.pdf`; }
    toast(msg, "ok"); status(msg);
  } catch (e) { toast(e.message, "err"); }
}
/* Saves, renders every page, then has the server build the book formats from those pages (mp/export.py). */
export async function exportBook(formats, options) {
  if (!S.name || S.dirty) { await save(); if (!S.name) return null; }
  await uploadPages(S.doc.pages.map((_, i) => i), true);
  status("Building " + formats.join(", ") + "…");
  const r = await post(`/api/export/book?name=${encodeURIComponent(S.name)}`, { formats, options });
  status(`Exported to pages/${S.name}/export/`);
  return r;
}
export async function downloadPage() {
  const c = await renderFull(S.page), out = cut(c, { x: 0, y: 0, w: c.width, h: c.height });
  const a = h("a", { href: out.toDataURL("image/png"), download: `${S.name || "page"}_${String(slotOf(S.doc, S.page)).padStart(2, "0")}.png` }); a.click();
}

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_project() {
  let saving = false;
  setInterval(() => {
    if (!S.doc || !S.dirty || saving) return;
    saving = true;
    writeAutosave(S.name, S.doc).catch(() => { try { localStorage.setItem("mm.autosave", JSON.stringify({ name: S.name, doc: S.doc })); } catch { } }).finally(() => { saving = false; });
  }, 5000);

  addEventListener("beforeunload", e => { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });
}
