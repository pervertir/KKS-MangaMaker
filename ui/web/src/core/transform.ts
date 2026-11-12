import type { Pt } from "./geometry/region.ts";

/** A layer's box: top-left, size, rotation in degrees about its centre. */
export interface Box { x: number; y: number; w: number; h: number; rotate?: number }
export type Handle = { kind: "scale"; hx: -1 | 0 | 1; hy: -1 | 0 | 1 } | { kind: "rotate" };
export interface TransformRules {
  /** corner handles keep the aspect ratio unless Shift is held (pictures, template bubbles) */
  aspect?: boolean;
  /** shows the rotate handle */
  rotate?: boolean;
  /** smallest width and height in page px */
  min?: number;
}
export const SCALE_HANDLES: [-1 | 0 | 1, -1 | 0 | 1][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
/** distance of the rotate knob above the top edge, in screen px */
export const ROTATE_ARM = 34;

/** The box's frame: P(dx, dy) maps an offset from the centre (unrotated) to page px; toLocal maps back. */
export function frame(b: Box) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, a = (b.rotate || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return {
    cx, cy, a,
    P: (dx: number, dy: number): Pt => [cx + dx * c - dy * s, cy + dx * s + dy * c],
    toLocal: ([x, y]: Pt): Pt => { const dx = x - cx, dy = y - cy; return [dx * c + dy * s, -dx * s + dy * c]; },
  };
}
/** Every handle and where it is drawn; `px` is one screen pixel in page px. */
export function handles(b: Box, px: number, rules: TransformRules = {}): { handle: Handle; pt: Pt }[] {
  const f = frame(b), hw = b.w / 2, hh = b.h / 2;
  const out: { handle: Handle; pt: Pt }[] = SCALE_HANDLES.map(([hx, hy]) => ({ handle: { kind: "scale", hx, hy }, pt: f.P(hx * hw, hy * hh) }));
  if (rules.rotate !== false) out.push({ handle: { kind: "rotate" }, pt: f.P(0, -hh - ROTATE_ARM * px) });
  return out;
}
export function hitHandle(b: Box, p: Pt, px: number, rules: TransformRules = {}): Handle | null {
  const q = frame(b).toLocal(p), hw = b.w / 2, hh = b.h / 2;
  if (rules.rotate !== false && Math.hypot(q[0], q[1] + hh + ROTATE_ARM * px) < 9 * px) return { kind: "rotate" };
  for (const [hx, hy] of SCALE_HANDLES) if (Math.abs(q[0] - hx * hw) < 8 * px && Math.abs(q[1] - hy * hh) < 8 * px) return { kind: "scale", hx, hy };
  return null;
}
/** The box after dragging a scale handle to p. The opposite side stays put, or the centre with `fromCentre`. */
export function scaleBox(b0: Box, h: { hx: number; hy: number }, p: Pt, o: { keepAspect?: boolean; fromCentre?: boolean; min?: number } = {}): Box {
  const min = o.min ?? 12, f = frame(b0), [qx, qy] = f.toLocal(p);
  let w = h.hx ? Math.max(min, o.fromCentre ? Math.abs(qx) * 2 : h.hx * qx + b0.w / 2) : b0.w;
  let hh = h.hy ? Math.max(min, o.fromCentre ? Math.abs(qy) * 2 : h.hy * qy + b0.h / 2) : b0.h;
  if (o.keepAspect) {
    if (h.hx && h.hy) { const s = Math.max(w / b0.w, hh / b0.h); w = b0.w * s; hh = b0.h * s; }
    else if (h.hx) hh = b0.h * w / b0.w; else w = b0.w * hh / b0.h;
  }
  const lx = o.fromCentre ? 0 : h.hx ? h.hx * (w - b0.w) / 2 : 0, ly = o.fromCentre ? 0 : h.hy ? h.hy * (hh - b0.h) / 2 : 0;
  const c = Math.cos(f.a), s = Math.sin(f.a), ncx = f.cx + lx * c - ly * s, ncy = f.cy + lx * s + ly * c;
  return { x: ncx - w / 2, y: ncy - hh / 2, w, h: hh, rotate: b0.rotate || 0 };
}
/** Rotation (degrees, -180..180) that points the rotate knob at p; snapped to `step` degrees when given. */
export function rotateTo(b0: Box, p: Pt, step = 0): number {
  const f = frame(b0);
  let a = Math.atan2(p[1] - f.cy, p[0] - f.cx) * 180 / Math.PI + 90;
  if (step) a = Math.round(a / step) * step;
  a = ((a + 180) % 360 + 360) % 360 - 180;
  return +a.toFixed(1);
}
export const cursorFor = (h: Handle, rotateDeg = 0): string => {
  if (h.kind === "rotate") return "alias";
  const ang = (Math.atan2(h.hy, h.hx) * 180 / Math.PI + rotateDeg + 360) % 180;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][Math.round(ang / 45) % 4];
};
