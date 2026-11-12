import { schedThumbs } from "./pages.js";
import { requestDraw } from "./view.js";

/* ================================================================ images */
/* Every picture is fetched at the smallest size that is sharp on screen (256 … 2048 px wide, resized
   and cached by the server), so a zoomed-out page decodes and draws a fraction of the pixels.
   While a sharper level loads, the best one already decoded is drawn instead. */
export const IMG = new Map();
export const LEVELS = [256, 512, 1024, 2048];
export function imgW(ref) { return ref.startsWith("tpl:") ? 2048 : 0; }
export function getImg(ref, w = 0) {
  const k = ref + "|" + w;
  let im = IMG.get(k);
  if (!im) {
    im = new Image();
    im.decoding = "async";
    im.onload = () => { requestDraw(); schedThumbs(true); };
    im.src = `/img?ref=${encodeURIComponent(ref)}${w ? "&w=" + w : ""}`;
    IMG.set(k, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}
export function imgFor(ref, needPx) {
  const lvl = LEVELS.find(v => v >= needPx * 1.15) || LEVELS[LEVELS.length - 1];
  const want = getImg(ref, lvl);
  if (want) return want;
  let best = null;
  for (const v of LEVELS) { const im = IMG.get(ref + "|" + v); if (im?.complete && im.naturalWidth) best = im; }
  return best;
}
export const thumb = (ref, w = 240) => `/img?ref=${encodeURIComponent(ref)}&w=${w}`;
export function waitImages() {
  const pend = [...IMG.values()].filter(i => !i.complete);
  if (!pend.length) return Promise.resolve();
  return Promise.all(pend.map(i => new Promise(r => { i.onload = i.onerror = r; })));
}
