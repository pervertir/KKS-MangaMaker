import { canvas } from "./blobs.ts";
import type { Brush } from "./settings.ts";

/** One pen sample in the layer's own pixels. */
export interface Sample { x: number; y: number; p: number; tx: number; ty: number }

const TIPS = new Map<string, HTMLCanvasElement>();
/* the dab image, already in the stroke colour, drawn at about the size it is used (small dabs from a
   big image would alias), with a one-pixel soft rim so hard tips stay anti-aliased */
function tipImage(b: Brush, color: string, d: number): HTMLCanvasElement {
  const TIP = d <= 6 ? 8 : d <= 12 ? 16 : d <= 24 ? 32 : d <= 48 ? 64 : 128;
  const key = `${b.tip}|${b.hardness}|${color}|${TIP}`;
  let c = TIPS.get(key);
  if (c) return c;
  c = canvas(TIP, TIP);
  const g = c.getContext("2d")!, r = TIP / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r), hard = Math.min(1 - 1.5 / TIP, Math.max(0, b.hardness));
  grad.addColorStop(0, "#000"); grad.addColorStop(hard, "#000"); grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad; g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  if (b.tip === "grain") {
    const im = g.getImageData(0, 0, TIP, TIP), d = im.data;
    let s = 7;
    for (let i = 3; i < d.length; i += 4) { s = (s * 16807) % 2147483647; if (s % 100 < 45) d[i] = d[i] * (s % 7) / 9; }
    g.putImageData(im, 0, 0);
  }
  g.globalCompositeOperation = "source-in"; g.fillStyle = color; g.fillRect(0, 0, TIP, TIP);
  if (TIPS.size > 80) TIPS.delete(TIPS.keys().next().value!);
  TIPS.set(key, c);
  return c;
}

/** Lays dabs along the samples into a canvas. `scale` is page px per layer px, so sizes stay in page px. */
export class Stamper {
  last: Sample | null = null;
  rest = 0;
  dist = 0;
  box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  constructor(public g: CanvasRenderingContext2D, public b: Brush, public color: string, public scale: number,
              public total = 0) {}
  sizeAt(s: Sample): number {
    const b = this.b, [t0, t1] = b.taper;
    let k = 1 - b.pSize * (1 - s.p);
    if (t0 > 0) k *= Math.min(1, 0.15 + this.dist * this.scale / t0);
    if (t1 > 0 && this.total > 0) k *= Math.min(1, 0.15 + Math.max(0, this.total - this.dist) * this.scale / t1);
    return Math.max(0.2, b.size * k / this.scale);
  }
  dab(s: Sample) {
    const b = this.b, g = this.g;
    let d = this.sizeAt(s), a = b.flow * (1 - b.pOpacity * (1 - s.p));
    if (d < 1) { a *= d; d = 1; }                                       // below a pixel, fade instead of shrinking
    g.globalAlpha = Math.max(0, Math.min(1, a));
    const tip = tipImage(b, this.color, d);
    const tilt = b.tilt ? Math.min(0.7, Math.hypot(s.tx, s.ty) / 90) : 0;
    if (tilt > 0.05) {
      g.save(); g.translate(s.x, s.y); g.rotate(Math.atan2(s.ty, s.tx));
      g.drawImage(tip, -d / 2, -d * (1 - tilt) / 2, d, d * (1 - tilt)); g.restore();
    } else g.drawImage(tip, s.x - d / 2, s.y - d / 2, d, d);
    const r = d / 2 + 1, B = this.box;
    B.x0 = Math.min(B.x0, s.x - r); B.y0 = Math.min(B.y0, s.y - r); B.x1 = Math.max(B.x1, s.x + r); B.y1 = Math.max(B.y1, s.y + r);
  }
  step(s: Sample): number { return Math.max(0.5 / this.scale, this.sizeAt(s) * this.b.spacing); }
  add(s: Sample) {
    const a = this.last;
    if (!a) { this.dab(s); this.last = s; this.rest = this.step(s); return; }
    const len = Math.hypot(s.x - a.x, s.y - a.y);
    if (len < 1e-6) return;
    let t = 0, need = this.rest;
    while (need <= len - t) {
      t += need; this.dist += need;
      const f = t / len, q: Sample = { x: a.x + (s.x - a.x) * f, y: a.y + (s.y - a.y) * f, p: a.p + (s.p - a.p) * f, tx: s.tx, ty: s.ty };
      this.dab(q); need = this.step(q);
    }
    this.dist += len - t; this.rest = need - (len - t); this.last = s;
  }
}
export function pathLength(ss: Sample[]): number {
  let n = 0;
  for (let i = 1; i < ss.length; i++) n += Math.hypot(ss[i].x - ss[i - 1].x, ss[i].y - ss[i - 1].y);
  return n;
}
