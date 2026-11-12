import { idbAvailable, idbGet, idbPut } from "./idb.ts";

/** Content-addressed binary data for a project: painted layers, masks, imported art, 3D renders.
 *  A layer refers to one as the string "blob:<sha256>". Blobs live in memory, in IndexedDB (so autosave and
 *  undo survive a reload) and, once the project is saved, in pages/<name>/blobs/<sha256> on the server. */
export const BLOB_REF = /^blob:([0-9a-f]{64})$/;
const mem = new Map<string, Blob>();
const onServer = new Set<string>();

export async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export const refOf = (hash: string): string => "blob:" + hash;
export const hashOf = (ref: string): string | null => BLOB_REF.exec(ref)?.[1] ?? null;

/** Stores data and returns its ref ("blob:<sha256>"). Storing the same bytes twice costs nothing. */
export async function putBlob(data: Blob | ArrayBuffer | Uint8Array, type = "application/octet-stream"): Promise<string> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const hash = await sha256(await blob.arrayBuffer());
  if (!mem.has(hash)) {
    mem.set(hash, blob);
    if (idbAvailable()) await idbPut("blobs", hash, blob).catch(() => {});
  }
  return refOf(hash);
}
/** Finds a blob by ref or hash: memory, then IndexedDB, then the server copy of `project`. */
export async function getBlob(refOrHash: string, project?: string): Promise<Blob | null> {
  const hash = hashOf(refOrHash) ?? refOrHash;
  const hit = mem.get(hash);
  if (hit) return hit;
  if (idbAvailable()) {
    const b = await idbGet<Blob>("blobs", hash).catch(() => undefined);
    if (b) { mem.set(hash, b); return b; }
  }
  if (project) {
    const r = await fetch(`/api/project/${encodeURIComponent(project)}/blob/${hash}`);
    if (r.ok) { const b = await r.blob(); mem.set(hash, b); onServer.add(project + "/" + hash); return b; }
  }
  return null;
}
/** Every blob ref a document mentions, anywhere in its JSON. */
export function blobRefs(doc: unknown): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") { const h = hashOf(v); if (h) out.add(h); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(doc);
  return [...out];
}
/** Uploads the blobs `doc` uses that the server does not have yet. Throws if one is missing locally. */
export async function uploadBlobs(project: string, doc: unknown): Promise<number> {
  let sent = 0;
  for (const hash of blobRefs(doc)) {
    const key = project + "/" + hash;
    if (onServer.has(key)) continue;
    const b = await getBlob(hash, project);
    if (!b) throw new Error(`missing image data ${hash.slice(0, 8)}…`);
    if (!onServer.has(key)) {
      const r = await fetch(`/api/project/${encodeURIComponent(project)}/blob/${hash}`, { method: "PUT", body: b });
      if (!r.ok) throw new Error(`could not upload image data: ${(await r.json().catch(() => ({}))).error || r.status}`);
      sent++;
    }
    onServer.add(key);
  }
  return sent;
}
