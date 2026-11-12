/* Line breaking and placement for lettering, horizontal or vertical (tategaki), with furigana.

   The result is a list of glyph draws in coordinates relative to the text centre, so the same layout is
   drawn on the page, measured for the in-place editor and fitted into a balloon's real outline. */
import { type Tok, type Unit, units } from "./ruby.ts";

/* kinsoku shori: what may not start or end a line/column */
const NO_START = new Set([..."、。，．,.・：；:;？！?!ー－〜～…‥」』）］｝〕〉》】〙〛）〟’”ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々ゝゞヽヾ)]}"]);
const NO_END = new Set([..."「『（［｛〔〈《【〘〚〝‘“([{"]);
const HANG = new Set([..."、。，．,."]);
/* drawn on their side in vertical text */
const ROTATE = new Set([..."ー－〜～…‥—―‐–-~（）()「」『』［］[]｛｝{}〔〕〈〉《》【】〘〙〚〛＜＞<>＝=→←⇒⇔：:；;"]);
const CORNER = new Set([..."、。，．,."]);
const SMALL = new Set([..."ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ"]);

export interface Measure { (text: string, px: number): number }
/** Space available to one line (horizontal) or column (vertical): [start, end] along the line, or null. */
export interface Shape { span(pos: number, thick: number, vertical: boolean): [number, number] | null; w: number; h: number; key: string }

export interface Opts { vertical: boolean; align?: string; ruby?: number; gap?: number; tracking?: number }

/** One thing to draw; x/y is the centre of its cell (or of its baseline run, horizontally). */
export interface GlyphDraw {
  t: string; x: number; y: number; px: number;
  rot?: boolean; corner?: boolean; small?: boolean; squeeze?: number; ruby?: boolean; run?: boolean;
  /** placed freely (SFX on a path): centred on x/y, turned by a radians, scaled by sc */
  free?: { a: number; sc: number; sy?: number };
}
export interface Laid { px: number; pitch: number; lines: string[]; draws: GlyphDraw[]; ok: boolean; extent: number }

const RUBY = 0.5;

export function boxShape(w: number, h: number): Shape {
  return { w, h, key: `box${Math.round(w)}x${Math.round(h)}`, span: (_p, _t, v) => v ? [-h / 2, h / 2] : [-w / 2, w / 2] };
}

interface Line { us: Unit[]; len: number; span: [number, number] }

export function layout(text: string, shape: Shape, px: number, o: Opts, measure: Measure): Laid {
  const V = o.vertical, us = units(text, V), rpx = px * (o.ruby ?? RUBY), track = (o.tracking || 0) * px;
  const hasRuby = us.some(u => u.ruby);
  const pitch = px * (V ? 1.25 : 1.15) + (hasRuby ? rpx * 1.05 : 0) + (o.gap || 0) * px;
  const tokLen = (t: Tok): number => {
    if (!V) return t.k === "space" ? measure(" ", px) : measure(t.t, px) + track * [...t.t].length;
    if (t.k === "cjk") return px + track;
    if (t.k === "tcy") return px + track;
    if (t.k === "space") return px * 0.4;
    return measure(t.t, px) + track;
  };
  const baseLen = (u: Unit) => u.toks.reduce((s, t) => s + tokLen(t), 0);
  const rubyLen = (u: Unit) => !u.ruby ? 0 : V ? [...u.ruby].length * rpx : measure(u.ruby, rpx);
  /* furigana longer than its base may overhang the neighbours by half a ruby character on each side */
  const adv = (u: Unit) => { const b = baseLen(u), r = rubyLen(u); return r > b ? Math.max(b, r - rpx) : b; };
  const lone = (u: Unit) => u.toks.length === 1 && !u.ruby ? u.toks[0].t : "";

  /* how many lines there will be decides where each sits, which decides how long each may be */
  const extent = V ? shape.w : shape.h;
  let n = 1, lines: Line[] = [], ok = true;
  for (let pass = 0; pass < 4; pass++) {
    const pos = (i: number) => V ? (n - 1) * pitch / 2 - i * pitch : -(n - 1) * pitch / 2 + i * pitch;
    const spanOf = (i: number): [number, number] => {
      if (i >= n) return V ? [-shape.h / 2, shape.h / 2] : [-shape.w / 2, shape.w / 2];
      return shape.span(pos(i), pitch, V) || [0, 0];
    };
    lines = []; ok = true;
    let cur: Unit[] = [], len = 0, sp = spanOf(0);
    const push = () => {
      while (cur.length && cur[cur.length - 1].toks[0].k === "space") len -= adv(cur.pop()!);
      lines.push({ us: cur, len, span: sp }); cur = []; len = 0; sp = spanOf(lines.length);
    };
    for (const u of us) {
      if (u.toks[0].k === "nl") { push(); continue; }
      if (!cur.length && u.toks[0].k === "space") continue;
      const a = adv(u), cap = sp[1] - sp[0];
      if (len + a <= cap + 0.5 || !cur.length) { cur.push(u); len += a; continue; }
      if (HANG.has(lone(u))) { cur.push(u); len += a; continue; }      // burasage: a comma or full stop hangs
      const carry: Unit[] = [];
      if (NO_START.has(lone(u)) && cur.length > 1) carry.unshift(cur.pop()!);
      while (cur.length > 1 && NO_END.has(lone(cur[cur.length - 1]))) carry.unshift(cur.pop()!);
      len = cur.reduce((s, q) => s + adv(q), 0);
      push();
      for (const q of carry) { cur.push(q); len += adv(q); }
      if (!(u.toks[0].k === "space" && !cur.length)) { cur.push(u); len += a; }
    }
    if (cur.length || !lines.length) push();
    if (lines.length === n) break;
    n = lines.length;
  }
  for (const L of lines) {
    const cap = L.span[1] - L.span[0], last = L.us[L.us.length - 1];
    const hang = last && HANG.has(lone(last)) ? adv(last) : 0;
    if (L.len - hang > cap + 0.5) ok = false;
  }
  if (lines.length * pitch > extent + 0.5) ok = false;

  const draws: GlyphDraw[] = [], strs: string[] = [];
  lines.forEach((L, i) => {
    const pos = V ? (lines.length - 1) * pitch / 2 - i * pitch : -(lines.length - 1) * pitch / 2 + i * pitch;
    const [a, b] = L.span, al = o.align || "center";
    let at = al === "left" ? a : al === "right" ? b - L.len : (a + b) / 2 - L.len / 2;
    if (!V && al === "center" && b - a <= 0) at = -L.len / 2;
    strs.push(L.us.map(u => u.toks.map(t => t.t).join("")).join(""));
    let run = "", runAt = 0;
    const flushRun = () => {
      if (run) draws.push({ t: run, x: runAt, y: pos, px, run: true });
      run = "";
    };
    for (const u of L.us) {
      const w = adv(u), bl = baseLen(u);
      let p = at + (w - bl) / 2;
      if (!V && !u.ruby) {
        if (!run) runAt = p;
        run += u.toks.map(t => t.t).join("");
        at += w; continue;
      }
      flushRun();
      for (const t of u.toks) {
        const tl = tokLen(t);
        if (V) {
          const c = p + tl / 2;
          if (t.k === "cjk") draws.push({ t: t.t, x: pos, y: c, px, rot: ROTATE.has(t.t), corner: CORNER.has(t.t), small: SMALL.has(t.t) });
          else if (t.k === "tcy") draws.push({ t: t.t, x: pos, y: c, px, squeeze: Math.min(1, px * 0.95 / Math.max(1, measure(t.t, px))) });
          else if (t.k === "latin") draws.push({ t: t.t, x: pos, y: c, px, rot: true });
        } else if (t.k !== "space") draws.push({ t: t.t, x: p, y: pos, px, run: true });
        p += tl;
      }
      if (u.ruby) {
        const rs = [...u.ruby], rl = rubyLen(u), start = at + (w - rl) / 2;
        if (V) {
          const step = rs.length > 1 && rl < bl ? (bl - rpx) / (rs.length - 1) : rpx, s0 = rl < bl ? at + (w - bl) / 2 + rpx / 2 : start + rpx / 2;
          const rx = pos + px / 2 + rpx * 0.6;
          rs.forEach((c, k) => draws.push({ t: c, x: rx, y: rs.length === 1 ? at + w / 2 : s0 + k * step, px: rpx, ruby: true, rot: ROTATE.has(c), small: SMALL.has(c) }));
        } else draws.push({ t: u.ruby, x: start, y: pos - px / 2 - rpx * 0.55, px: rpx, ruby: true, run: true });
      }
      at += w;
    }
    flushRun();
  });
  return { px, pitch, lines: strs, draws, ok, extent: lines.length * pitch };
}

/** Largest size up to maxPx whose layout fits; a fixed size when px > 0. */
export function fitLayout(text: string, shape: Shape, maxPx: number, fixed: number, o: Opts, measure: Measure): Laid {
  if (fixed > 0) return layout(text, shape, fixed, o, measure);
  let lo = 6, hi = Math.max(7, Math.floor(maxPx)), best: Laid | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, r = layout(text, shape, mid, o, measure);
    if (r.ok) { best = r; lo = mid + 1; } else hi = mid - 1;
  }
  return best || layout(text, shape, 6, o, measure);
}

export interface Paint { fill: string; stroke?: string; strokeW?: number; paper?: string; paperW?: number; font: (px: number) => string }

/** Draws a layout centred on (cx, cy): paper outline, then ink outline, then fill, per pass over all glyphs so
    neighbouring outlines never cover a letter. */
export function drawLaid(ctx: CanvasRenderingContext2D, L: { draws: GlyphDraw[] }, cx: number, cy: number, p: Paint, vertical: boolean): void {
  const passes: ("paper" | "stroke" | "fill")[] = [];
  if (p.paperW && p.paper) passes.push("paper");
  if (p.strokeW) passes.push("stroke");
  passes.push("fill");
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = "round"; ctx.miterLimit = 2;
  for (const pass of passes) {
    if (pass === "paper") { ctx.strokeStyle = p.paper!; ctx.lineWidth = ((p.strokeW || 0) + p.paperW!) * 2; }
    if (pass === "stroke") { ctx.strokeStyle = p.stroke || "#000"; ctx.lineWidth = p.strokeW! * 2; }
    if (pass === "fill") ctx.fillStyle = p.fill;
    for (const g of L.draws) glyph(ctx, g, pass === "fill", vertical, p.font);
  }
  ctx.restore();
}

export function glyph(ctx: CanvasRenderingContext2D, g: GlyphDraw, fill: boolean, vertical: boolean, font: (px: number) => string): void {
  ctx.font = font(g.px);
  const paint = (t: string, x: number, y: number) => fill ? ctx.fillText(t, x, y) : ctx.strokeText(t, x, y);
  if (g.free) {
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.free.a); ctx.scale(g.free.sc, g.free.sc * (g.free.sy ?? 1));
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (g.rot) ctx.rotate(Math.PI / 2);
    paint(g.t, 0, 0); ctx.restore(); return;
  }
  if (!vertical) {
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    paint(g.t, g.x, g.y); return;
  }
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (g.rot) {
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(Math.PI / 2); paint(g.t, 0, 0); ctx.restore(); return;
  }
  if (g.squeeze != null) {
    ctx.save(); ctx.translate(g.x, g.y); ctx.scale(g.squeeze, 1); paint(g.t, 0, 0); ctx.restore(); return;
  }
  if (g.corner) {
    /* a full stop or comma sits in the top-right of its cell: move the ink there, whatever the font */
    const m = ctx.measureText(g.t);
    const ix = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, iy = (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
    paint(g.t, g.x - ix + g.px * 0.25, g.y - iy - g.px * 0.25); return;
  }
  if (g.small) { paint(g.t, g.x + g.px * 0.08, g.y - g.px * 0.1); return; }
  paint(g.t, g.x, g.y);
}
