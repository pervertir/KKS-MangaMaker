import { $, post } from "./core.js";
import { addImageLayer, createAt, setPanelImage } from "./creation.js";
import { hitLayer } from "./hit.js";
import { imgW } from "./images.js";
import { refreshPanels, toast } from "./misc.js";
import { S } from "./state.ts";
import { cv, stage, toPage, toScreen } from "./view.js";
import { ui } from "../ui/store.svelte.ts";
import { addEffect, toneFields } from "./effects/apply.ts";
import { toneById } from "./effects/tones.ts";

/* ================================================================ library */
export const LIBTABS = [["shots", "Shots"], ["bubbles", "Bubbles"], ["layouts", "Layouts"], ["tones", "Tones"], ["decor", "Decor"], ["speedlines", "Speed lines"], ["particles", "Particles"], ["uploads", "Uploads"]];
/* The tab itself is src/ui/Library.svelte; this tells it to read the editor state again. */
export function renderLibrary() { ui.rev++; }
export function imgSize(ref) {
  return new Promise(res => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.src = `/img?ref=${encodeURIComponent(ref)}&w=${imgW(ref)}`; });
}
export async function uploadFile(f, at) {
  try {
    const r = await post(`/api/upload?name=${encodeURIComponent(f.name)}`, f, true);
    S.cat.assets.uploads.push({ ref: r.ref, name: r.name, multiply: false });
    if (S.libTab === "uploads") renderLibrary();
    return r;
  } catch (e) { toast(e.message, "err"); }
}

/* drag & drop onto the canvas */
export const mark = $("#dropmark");

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_library() {
  stage.addEventListener("dragover", e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
    const pl = hitLayer(p, l => l.type === "panel");
    const isRender = e.dataTransfer.types.includes("application/x-manga") || e.dataTransfer.types.includes("Files");
    if (pl && isRender) {
      const a = toScreen(pl.x, pl.y);
      Object.assign(mark.style, { display: "block", left: a.x + "px", top: a.y + "px", width: pl.w * S.view.s + "px", height: pl.h * S.view.s + "px" });
    } else mark.style.display = "none";
  });

  stage.addEventListener("dragleave", () => mark.style.display = "none");

  stage.addEventListener("drop", async e => {
    e.preventDefault(); mark.style.display = "none";
    const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
    const pl = hitLayer(p, l => l.type === "panel");
    if (e.dataTransfer.files.length) {
      for (const f of e.dataTransfer.files) {
        const u = await uploadFile(f); if (!u) continue;
        if (pl && !pl.image) setPanelImage(pl, u.ref, ""); else addImageLayer(u.ref, u.w, u.h, p, false);
      }
      return;
    }
    const raw = e.dataTransfer.getData("application/x-manga"); if (!raw) return;
    const d = JSON.parse(raw);
    if (d.kind === "render") {
      if (pl) { S.sel = pl.id; setPanelImage(pl, d.ref, d.shot); }
      else { const dim = await imgSize(d.ref); addImageLayer(d.ref, dim.w, dim.h, p, false); }
    } else if (d.kind === "bubble") { S.bubble = d.key; createAt("bubble", { x: p.x, y: p.y, w: 0, h: 0 }, true); }
    else if (d.kind === "tone") {
      const t = toneById(d.id);
      if (t) { S.toneId = t.id; const box = pl ? { x: pl.x, y: pl.y, w: pl.w, h: pl.h } : { x: p.x - 300, y: p.y - 300, w: 600, h: 600 }; addEffect("tone", toneFields(t.spec), box, pl); }
    }
    else if (d.kind === "asset") { const dim = await imgSize(d.ref); addImageLayer(d.ref, dim.w, dim.h, p, d.multiply); }
    refreshPanels();
  });
}
