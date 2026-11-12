import { apply, clone, diff, patchBytes, type Patch } from "./patches.ts";

/** Undo for edits that do not live in the document (painted tiles, blobs). Called with the document already
 *  at the matching state. `bytes` counts against the history's memory budget. */
export interface CustomStep { undo(): void; redo(): void; bytes: number; dispose?(): void }

export interface Step {
  label: string;
  fwd: Patch[];
  inv: Patch[];
  pageBefore: number;
  pageAfter: number;
  custom?: CustomStep;
  bytes: number;
}

export interface HistoryState<D> {
  undo: Step[];
  redo: Step[];
  /** the document as of the last commit; diffs are taken against it */
  base: D | null;
  basePage: number;
}

export const LIMITS = { steps: 300, bytes: 512 * 1024 * 1024 };

export const createHistory = <D>(): HistoryState<D> => ({ undo: [], redo: [], base: null, basePage: 0 });

export function reset<D>(h: HistoryState<D>, doc: D, page: number): void {
  h.base = clone(doc); h.basePage = page;
}

/** Records the change from the last commit to `doc`. Returns the step, or null when nothing changed and no custom step was given.
 *  `touched` is called with each changed path so callers can bump revisions; changes it makes are folded into the step. */
export function commit<D>(h: HistoryState<D>, doc: D, page: number, label: string, custom?: CustomStep, touched?: (paths: Patch["path"][]) => void): Step | null {
  if (h.base === null) reset(h, doc, page);
  let fwd = diff(h.base, doc);
  if (!fwd.length && !custom) { h.basePage = page; return null; }
  if (touched && fwd.length) { touched(fwd.map(p => p.path)); fwd = diff(h.base, doc); }
  const inv = diff(doc, h.base);
  const step: Step = { label, fwd, inv, pageBefore: h.basePage, pageAfter: page, custom, bytes: patchBytes(fwd) + patchBytes(inv) + (custom?.bytes || 0) };
  h.undo.push(step);
  for (const s of h.redo) s.custom?.dispose?.();
  h.redo.length = 0;
  h.base = clone(doc); h.basePage = page;
  trim(h);
  return step;
}

function trim<D>(h: HistoryState<D>): void {
  let total = h.undo.reduce((n, s) => n + s.bytes, 0);
  while (h.undo.length > 1 && (h.undo.length > LIMITS.steps || total > LIMITS.bytes)) {
    const s = h.undo.shift()!; total -= s.bytes; s.custom?.dispose?.();
  }
}

/** Steps back once. Returns the new document root (patches may replace it) and the page to show, or null. */
export function undo<D>(h: HistoryState<D>, doc: D): { doc: D; page: number; step: Step } | null {
  const s = h.undo.pop(); if (!s) return null;
  s.custom?.undo();
  doc = apply(doc, s.inv);
  h.base = clone(doc); h.basePage = s.pageBefore;
  h.redo.push(s);
  return { doc, page: s.pageBefore, step: s };
}
export function redo<D>(h: HistoryState<D>, doc: D): { doc: D; page: number; step: Step } | null {
  const s = h.redo.pop(); if (!s) return null;
  doc = apply(doc, s.fwd);
  s.custom?.redo();
  h.base = clone(doc); h.basePage = s.pageAfter;
  h.undo.push(s);
  return { doc, page: s.pageAfter, step: s };
}
