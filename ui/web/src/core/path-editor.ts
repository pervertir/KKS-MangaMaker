import type { Pt } from "./geometry/region.ts";
import { toPath2D, type Path } from "./geometry/path.ts";
import { deleteNode, hitNode, identityFrame, insertNode, moveNode, nodes, toggleSmooth, type Frame, type NodeRef } from "./node-editor.ts";
import { snapPoint } from "./snap.ts";

export interface PathEditorOptions {
  /** the path being edited, in its own (frame) coordinates */
  get(): Path | null;
  set(p: Path): void;
  /** maps path coordinates to page px; default identity */
  frame?(): Frame;
  /** called once per finished edit, so the caller can commit an undo step */
  done(label: string): void;
}
/** One node editor for every editable outline: balloons, panel edges, SFX baselines, tone regions, selections.
 *  Drag anchors and handles (snapped), double-click the outline to add a point, double-click an anchor to toggle
 *  smooth/corner, Alt-click an anchor to delete it. Feed it page-px points from a tool's events. */
export function pathEditor(o: PathEditorOptions) {
  let drag: { ref: NodeRef; moved: boolean } | null = null, lastDown = 0, lastRef: string | null = null;
  const fr = () => o.frame?.() ?? identityFrame;
  return {
    /** true when the point hit the path (anchor, handle or outline) and the event was used */
    down(pt: Pt, mods: { alt?: boolean }, px: number): boolean {
      const path = o.get(); if (!path) return false;
      const f = fr(), q = f.toLocal(pt), r = 8 * px;
      const now = performance.now(), ref = hitNode(path, q[0], q[1], r), key = ref && JSON.stringify(ref);
      const dbl = now - lastDown < 350 && key === lastRef; lastDown = now; lastRef = key;
      if (ref && ref.part === "anchor" && mods.alt) { o.set(deleteNode(path, ref)); o.done("Point removed"); return true; }
      if (ref && ref.part === "anchor" && dbl) { o.set(toggleSmooth(path, ref)); o.done("Point smooth / corner"); return true; }
      if (ref) { drag = { ref, moved: false }; return true; }
      const ins = insertNode(path, q[0], q[1], r);
      if (ins) { o.set(ins.path); drag = { ref: ins.ref, moved: true }; return true; }
      return false;
    },
    move(pt: Pt, mods: { alt?: boolean; noSnap?: boolean }, px: number): void {
      if (!drag) return;
      const path = o.get(); if (!path) return;
      const f = fr();
      const p = mods.noSnap ? pt : snapPoint(pt, { threshold: 7 * px }).pt;
      o.set(moveNode(path, drag.ref, f.toLocal(p), !mods.alt));
      drag.moved = true;
    },
    up(): void { if (drag?.moved) o.done("Shape edited"); drag = null; },
    get active(): boolean { return !!drag; },
    cancel(): void { drag = null; },
    overlay(ctx: CanvasRenderingContext2D, px: number): void {
      const path = o.get(); if (!path) return;
      const f = fr();
      ctx.save();
      const toPage = (q: Pt) => f.toPage(q);
      const m = (() => { const o0 = toPage([0, 0]), ox = toPage([1, 0]), oy = toPage([0, 1]); return new DOMMatrix([ox[0] - o0[0], ox[1] - o0[1], oy[0] - o0[0], oy[1] - o0[1], o0[0], o0[1]]); })();
      ctx.lineWidth = 1.5 * px; ctx.strokeStyle = "#4c8dff";
      const p2 = new Path2D(); p2.addPath(toPath2D(path), m); ctx.stroke(p2);
      const ns = nodes(path);
      ctx.lineWidth = px;
      for (const n of ns) if (n.part !== "anchor") {
        const a = toPage(path.subs[n.sub].segs[n.anchor - 1]?.p ?? path.subs[n.sub].start), h = toPage(n.pt);
        const an = n.anchor === 0 ? toPage(path.subs[n.sub].start) : a;
        ctx.beginPath(); ctx.moveTo(an[0], an[1]); ctx.lineTo(h[0], h[1]); ctx.stroke();
        ctx.beginPath(); ctx.arc(h[0], h[1], 3.5 * px, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.stroke();
      }
      for (const n of ns) if (n.part === "anchor") {
        const a = toPage(n.pt), sel = drag && drag.ref.sub === n.sub && drag.ref.anchor === n.anchor;
        ctx.fillStyle = sel ? "#4c8dff" : "#ffffff"; ctx.fillRect(a[0] - 4 * px, a[1] - 4 * px, 8 * px, 8 * px); ctx.strokeRect(a[0] - 4 * px, a[1] - 4 * px, 8 * px, 8 * px);
      }
      ctx.restore();
    },
  };
}
