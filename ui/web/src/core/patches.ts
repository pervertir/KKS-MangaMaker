/** Minimal structural diff and patch for JSON documents. Arrays of objects with string ids are compared by id,
 *  so editing one layer records only that layer's changed fields. */
export type Key = string | number;
export type Patch = { op: "replace" | "add" | "remove"; path: Key[]; value?: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const idOf = (v: unknown) => (isObj(v) && typeof v.id === "string" ? v.id : undefined);
export const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export function diff(a: unknown, b: unknown, path: Key[] = [], out: Patch[] = []): Patch[] {
  if (a === b) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    const ia = a.map(idOf), ib = b.map(idOf);
    const ided = ia.length > 0 && ia.every(Boolean) && ib.every(Boolean);
    if (ided ? ia.length === ib.length && ia.every((id, i) => id === ib[i]) : a.length === b.length && a.length > 0 && a.every(x => typeof x === "object")) {
      for (let i = 0; i < a.length; i++) diff(a[i], b[i], [...path, i], out);
    } else if (!(a.length === b.length && a.every((x, i) => x === b[i]))) out.push({ op: "replace", path, value: clone(b) });
    return out;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) if (!(k in b) || b[k] === undefined) { if (a[k] !== undefined) out.push({ op: "remove", path: [...path, k] }); }
    for (const k of Object.keys(b)) {
      if (b[k] === undefined) continue;
      if (!(k in a) || a[k] === undefined) out.push({ op: "add", path: [...path, k], value: clone(b[k]) });
      else diff(a[k], b[k], [...path, k], out);
    }
    return out;
  }
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return out;
  out.push({ op: "replace", path, value: clone(b) });
  return out;
}

/** Applies patches in place and returns the (possibly replaced) root. */
export function apply<T>(root: T, patches: Patch[]): T {
  for (const p of patches) {
    if (!p.path.length) { root = clone(p.value) as T; continue; }
    let o: any = root;
    for (let i = 0; i < p.path.length - 1; i++) o = o[p.path[i]];
    const k = p.path[p.path.length - 1];
    if (p.op === "remove") { if (Array.isArray(o)) o.splice(k as number, 1); else delete o[k]; }
    else o[k] = clone(p.value);
  }
  return root;
}

export const patchBytes = (ps: Patch[]): number => ps.reduce((n, p) => n + 16 + p.path.length * 8 + (p.value === undefined ? 0 : JSON.stringify(p.value).length), 0);
