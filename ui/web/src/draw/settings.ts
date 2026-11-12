/* What each drawing tool remembers between sessions. */

export type Tip = "round" | "grain";
export interface Brush {
  name: string;
  /** page px */
  size: number;
  /** of the whole stroke: overlapping dabs never build up past it */
  opacity: number;
  /** of each dab: low flow builds up like an airbrush */
  flow: number;
  /** dab distance as a fraction of the size */
  spacing: number;
  hardness: number;
  tip: Tip;
  /** 0..1: how much pressure thins the line / lightens it */
  pSize: number;
  pOpacity: number;
  /** page px over which the stroke grows at the start and shrinks at the end */
  taper: [number, number];
  /** pen tilt flattens the tip */
  tilt: boolean;
}
export const BRUSHES: Record<string, Brush> = {
  pen: { name: "Pen", size: 5, opacity: 1, flow: 1, spacing: 0.08, hardness: 1, tip: "round", pSize: 0.7, pOpacity: 0, taper: [0, 0], tilt: false },
  pencil: { name: "Pencil", size: 4, opacity: 0.9, flow: 0.55, spacing: 0.12, hardness: 0.7, tip: "grain", pSize: 0.35, pOpacity: 0.7, taper: [0, 0], tilt: true },
  ink: { name: "Ink brush", size: 14, opacity: 1, flow: 1, spacing: 0.05, hardness: 1, tip: "round", pSize: 1, pOpacity: 0, taper: [40, 70], tilt: true },
  marker: { name: "Marker", size: 26, opacity: 0.45, flow: 1, spacing: 0.08, hardness: 0.92, tip: "round", pSize: 0, pOpacity: 0, taper: [0, 0], tilt: false },
  airbrush: { name: "Airbrush", size: 140, opacity: 1, flow: 0.05, spacing: 0.06, hardness: 0, tip: "round", pSize: 0.4, pOpacity: 0.6, taper: [0, 0], tilt: false },
};
export const ERASER: Brush = { name: "Eraser", size: 30, opacity: 1, flow: 1, spacing: 0.08, hardness: 0.9, tip: "round", pSize: 0.4, pOpacity: 0, taper: [0, 0], tilt: false };

export interface InkPen { name: string; size: number; thinning: number; smoothing: number; streamline: number; taper: [number, number] }
export const INK_PENS: Record<string, InkPen> = {
  gpen: { name: "G-pen", size: 7, thinning: 0.65, smoothing: 0.6, streamline: 0.45, taper: [20, 30] },
  maru: { name: "Maru-pen (fine)", size: 3, thinning: 0.5, smoothing: 0.6, streamline: 0.5, taper: [8, 12] },
  brush: { name: "Brush pen", size: 16, thinning: 0.85, smoothing: 0.65, streamline: 0.5, taper: [50, 80] },
  mono: { name: "Monoline", size: 5, thinning: 0, smoothing: 0.5, streamline: 0.5, taper: [0, 0] },
  speed: { name: "Speed line", size: 6, thinning: 0.4, smoothing: 0.4, streamline: 0.7, taper: [9999, 9999] },
};

export type Stab = "none" | "smooth" | "rope";
export type VErase = "stroke" | "intersect" | "partial";
export interface DrawSettings {
  color: string;
  brush: string;
  brushes: Record<string, Brush>;
  eraser: Brush;
  verase: VErase;
  ink: string;
  inks: Record<string, InkPen>;
  stab: Stab;
  stabAmount: number;
  /** pressure ^ curve: below 1 soft, above 1 firm */
  curve: number;
  gap: number;
  tolerance: number;
}
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
export const DEFAULTS: DrawSettings = {
  color: "#000000", brush: "pen", brushes: clone(BRUSHES), eraser: clone(ERASER), verase: "stroke",
  ink: "gpen", inks: clone(INK_PENS), stab: "smooth", stabAmount: 4, curve: 1, gap: 3, tolerance: 48,
};
function load(): DrawSettings {
  let o: Partial<DrawSettings> = {};
  try { o = JSON.parse(localStorage.getItem("mm.draw") || "{}"); } catch { }
  const d = clone(DEFAULTS);
  return { ...d, ...o, brushes: { ...d.brushes, ...(o.brushes || {}) }, inks: { ...d.inks, ...(o.inks || {}) }, eraser: { ...d.eraser, ...(o.eraser || {}) } };
}
export const DS: DrawSettings = load();
export function saveDS() { try { localStorage.setItem("mm.draw", JSON.stringify(DS)); } catch { } }
export const curBrush = (): Brush => DS.brushes[DS.brush] || DS.brushes.pen;
export const curInk = (): InkPen => DS.inks[DS.ink] || DS.inks.gpen;
export function resetBrush() { DS.brushes[DS.brush] = clone(BRUSHES[DS.brush]); saveDS(); }
export function resetInk() { DS.inks[DS.ink] = clone(INK_PENS[DS.ink]); saveDS(); }
/* mono books: black, white and 8 greys */
export const SWATCHES = ["#000000", "#1c1c1c", "#383838", "#555555", "#717171", "#8e8e8e", "#aaaaaa", "#c6c6c6", "#e3e3e3", "#ffffff"];
