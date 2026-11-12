import { idbAvailable, idbDel, idbGet, idbPut } from "./idb.ts";

/** Unsaved work kept in IndexedDB (no 5 MB cap; pixel data goes to the blob store, not here). */
export interface Autosave<D> { name: string; doc: D; at: number }
const KEY = "current";

export async function writeAutosave<D>(name: string, doc: D): Promise<void> {
  if (!idbAvailable()) return;
  await idbPut("autosave", KEY, { name, doc: structuredClone(doc), at: Date.now() });
}
export async function readAutosave<D>(): Promise<Autosave<D> | null> {
  if (!idbAvailable()) return null;
  return (await idbGet<Autosave<D>>("autosave", KEY).catch(() => undefined)) ?? null;
}
export async function clearAutosave(): Promise<void> { if (idbAvailable()) await idbDel("autosave", KEY).catch(() => {}); }
