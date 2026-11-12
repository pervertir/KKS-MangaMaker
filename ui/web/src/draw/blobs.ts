import { getBlob, putBlob } from "../core/blobs.ts";
import { S } from "../editor/state.ts";

/* Painted tiles as canvases, over the project's content-addressed blobs (core/blobs.ts). A raster layer only
   names its tiles by blob ref, so undo, copies and duplicated pages share them. A canvas is kept while its
   tile is in use; any tile can be decoded again from its blob. */
const MEM = new Map<string, HTMLCanvasElement>();
const LOADING = new Map<string, Promise<void>>();
let loads = 0, queued = false, onLoad: () => void = () => {};
/** bumps whenever a tile arrives, so thumbnails know to paint again */
export const blobGen = () => loads;
export function onBlobLoad(fn: () => void) { onLoad = fn; }
function loaded() { loads++; if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; onLoad(); }); } }

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c;
}

export async function putTile(c: HTMLCanvasElement): Promise<string> {
  const png = await new Promise<Blob | null>(r => c.toBlob(r, "image/png"));
  if (!png) throw new Error("could not encode painted pixels");
  const ref = await putBlob(png, "image/png");
  MEM.set(ref, c);
  evict();
  return ref;
}
export function getTile(ref: string): HTMLCanvasElement | null {
  const c = MEM.get(ref);
  if (c) return c;
  ensureTile(ref);
  return null;
}
export function ensureTile(ref: string): Promise<void> {
  if (MEM.has(ref)) return Promise.resolve();
  let p = LOADING.get(ref);
  if (!p) {
    p = getBlob(ref, S.name || undefined).then(async b => {
      if (!b) return;
      const bm = await createImageBitmap(b);
      const c = canvas(bm.width, bm.height); c.getContext("2d")!.drawImage(bm, 0, 0); bm.close?.();
      MEM.set(ref, c); loaded();
    }).catch(() => {}).finally(() => LOADING.delete(ref));
    LOADING.set(ref, p);
  }
  return p;
}
export const waitTiles = (): Promise<unknown> => Promise.all([...LOADING.values()]);

function evict() {
  if (MEM.size < 700 || !S.doc) return;
  const keep = new Set<string>();
  for (const p of S.doc.pages) for (const l of p.layers) if (l.type === "raster") for (const r of Object.values(l.tiles || {})) keep.add(r as string);
  for (const k of MEM.keys()) if (!keep.has(k)) MEM.delete(k);
}
