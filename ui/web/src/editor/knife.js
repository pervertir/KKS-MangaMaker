import { h, uid } from "./core.js";
import { clipHalf, panelBase, polyArea, setPanelPoly } from "./frames.js";
import { S, H, W, page } from "./state.ts";

/* Knife cuts. A page keeps its cuts as lines: cuts [{id, a: [x, y], b: [x, y], gutter: null | px}].
   A panel made by cutting keeps the outline it was cut from and which side of each cut it lies on:
     knife {base: [[x, y], ...] page px, cuts: [[cutId, side ±1], ...], at: signature of the derived outline}
   Its outline is derived: base clipped to its side of every cut line, offset by half the gutter plus its border,
   so the white gap between two borders is exactly the gutter. Moving a cut or changing a gutter re-derives both
   neighbours. Editing a panel's geometry any other way detaches it into a free shape. */

export const GUTTERS = { h: 40, v: 20, margin: 60 };   // h: between tiers (a level cut), v: between panels side by side
export const gutters = (pg = page()) => (pg.gutters ||= { ...GUTTERS });
export const isLevel = c => Math.abs(c.b[0] - c.a[0]) >= Math.abs(c.b[1] - c.a[1]);
export const cutGutter = (c, pg = page()) => c.gutter ?? (isLevel(c) ? gutters(pg).h : gutters(pg).v);

export function cutPlane(c) {
  const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], d = Math.hypot(dx, dy) || 1, nx = dy / d, ny = -dx / d;
  return { nx, ny, k: nx * c.a[0] + ny * c.a[1] };
}
const sideOf = (c, P) => { const { nx, ny, k } = cutPlane(c); let s = 0; for (const p of P) s += p.x * nx + p.y * ny - k; return s >= 0 ? 1 : -1; };
const sig = l => [l.shape, l.x, l.y, l.w, l.h].map(v => typeof v === "number" ? v.toFixed(2) : v).join("|") + (l.shape === "poly" ? JSON.stringify(l.pts) : "");

export function knifeOutline(l, pg = page()) {
  let P = l.knife.base.map(([x, y]) => ({ x, y }));
  for (const [id, s] of l.knife.cuts) {
    const c = pg.cuts?.find(q => q.id === id); if (!c) continue;
    const { nx, ny, k } = cutPlane(c), off = cutGutter(c, pg) / 2 + (l.border || 0);
    P = clipHalf(P, s * nx, s * ny, s * k + off);
    if (P.length < 3) return null;
  }
  return Math.abs(polyArea(P)) < 400 ? null : P;
}
/* every panel on this cut keeps some area with the cut where it is */
export const cutFits = (c, pg = page()) => pg.layers.every(l => !l.knife?.cuts.some(r => r[0] === c.id) || knifeOutline(l, pg));
/* re-derive every knife panel on a page; panels whose geometry was changed by hand drop their knife data */
export function derivePage(pg = page()) {
  if (!pg) return;
  pg.cuts ||= [];
  for (const l of pg.layers) {
    if (l.type !== "panel" || !l.knife) continue;
    if (l.knife.at && l.knife.at !== sig(l)) { delete l.knife; continue; }
    const P = knifeOutline(l, pg);
    if (P) setPanelPoly(l, P);
    l.knife.at = sig(l);
  }
  const used = new Set(pg.layers.flatMap(l => l.knife ? l.knife.cuts.map(c => c[0]) : []));
  pg.cuts = pg.cuts.filter(c => used.has(c.id));
}

/* ---------------------------------------------------------------- cutting */
function segHits(P, a, b) {
  let n = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    const d = (b.x - a.x) * (q.y - p.y) - (b.y - a.y) * (q.x - p.x); if (Math.abs(d) < 1e-9) continue;
    const t = ((p.x - a.x) * (q.y - p.y) - (p.y - a.y) * (q.x - p.x)) / d, u = ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / d;
    if (t >= 0 && t <= 1 && u >= 0 && u < 1) n++;
  }
  return n;
}
/* cut `targets` (or every panel the segment crosses) along a..b; returns how many panels were cut */
export function knifeCut(a, b, targets, gutter = null, pg = page()) {
  if (Math.hypot(b.x - a.x, b.y - a.y) < 8) return 0;
  const c = { id: uid(), a: [+a.x.toFixed(1), +a.y.toFixed(1)], b: [+b.x.toFixed(1), +b.y.toFixed(1)], gutter };
  pg.cuts ||= []; pg.cuts.push(c);
  const ps = targets || pg.layers.filter(l => l.type === "panel" && l.visible && !l.rotate && segHits(panelBase(l), a, b) >= 2);
  let n = 0;
  for (const l of ps) {
    const prev = l.knife;
    if (!l.knife) l.knife = { base: panelBase(l).map(p => [+p.x.toFixed(2), +p.y.toFixed(2)]), cuts: [] };
    else if (l.knife.at && l.knife.at !== sig(l)) l.knife = { base: panelBase(l).map(p => [+p.x.toFixed(2), +p.y.toFixed(2)]), cuts: [] };
    const nb = JSON.parse(JSON.stringify(l)); nb.id = uid(); nb.image = null; nb.shot = ""; nb.breakout = null;
    if (nb.edge === "jagged" || nb.edge === "wavy") nb.seed = (nb.seed || 1) + 1;
    l.knife.cuts.push([c.id, 1]); nb.knife.cuts.push([c.id, -1]);
    const A = knifeOutline(l, pg), B = knifeOutline(nb, pg);
    if (!A || !B) { if (prev) prev.cuts = prev.cuts.filter(r => r[0] !== c.id); l.knife = prev; if (!prev) delete l.knife; continue; }
    if (Math.abs(polyArea(A)) < Math.abs(polyArea(B))) { l.knife.cuts[l.knife.cuts.length - 1][1] = -1; nb.knife.cuts[nb.knife.cuts.length - 1][1] = 1; }
    delete l.knife.at; delete nb.knife.at;
    pg.layers.splice(pg.layers.indexOf(l) + 1, 0, nb);
    n++;
  }
  derivePage(pg);
  return n;
}
/* split one panel through its centre: dir "v" side by side, "h" top / bottom, tilted by `tilt` degrees */
export function splitPanel(l, dir, tilt = 0) {
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2, a = tilt * Math.PI / 180, R = Math.hypot(l.w, l.h);
  const dx = dir === "v" ? -Math.sin(a) : Math.cos(a), dy = dir === "v" ? Math.cos(a) : Math.sin(a);
  return knifeCut({ x: cx - dx * R, y: cy - dy * R }, { x: cx + dx * R, y: cy + dy * R }, [l]);
}
/* remove a cut: its two sides become one panel again (the one with a render wins) */
export function mergeCut(id, pg = page()) {
  const keep = new Map();
  for (const l of [...pg.layers]) {
    if (l.type !== "panel" || !l.knife?.cuts.some(c => c[0] === id)) continue;
    l.knife.cuts = l.knife.cuts.filter(c => c[0] !== id); delete l.knife.at;
    const key = JSON.stringify([l.knife.base, [...l.knife.cuts].sort()]), o = keep.get(key);
    if (!o) { keep.set(key, l); continue; }
    const drop = !o.image && l.image ? o : l;
    if (drop === o) keep.set(key, l);
    pg.layers.splice(pg.layers.indexOf(drop), 1);
    for (const q of pg.layers) if (q.clip === drop.id) q.clip = keep.get(key).id;
    if (S.sel === drop.id) S.sel = keep.get(key).id;
  }
  for (const l of pg.layers) if (l.knife && !l.knife.cuts.length) { const P = l.knife.base.map(([x, y]) => ({ x, y })); delete l.knife; setPanelPoly(l, P); }
  pg.cuts = (pg.cuts || []).filter(c => c.id !== id);
  derivePage(pg);
}

/* ---------------------------------------------------------------- layouts and margins */
/* a layout tree of cuts in page fractions (frames.js cutLayout) as knife panels: returns panels with .cuts */
export function knifeLayout(tree, Wp, Hp, margin, extra = []) {
  const out = [], cuts = [];
  const base = [[margin, margin], [Wp - margin, margin], [Wp - margin, Hp - margin], [margin, Hp - margin]];
  const rec = (refs, node) => {
    if (!Array.isArray(node)) { out.push({ ...setPanelPoly({}, base.map(([x, y]) => ({ x, y }))), ...(node || {}), knife: { base, cuts: refs } }); return; }
    const [x0, y0, x1, y1, A, B] = node, c = { id: uid(), a: [x0 * Wp, y0 * Hp], b: [x1 * Wp, y1 * Hp], gutter: null };
    let { nx, ny } = cutPlane(c);
    const first = (Math.abs(c.b[1] - c.a[1]) > Math.abs(c.b[0] - c.a[0]) ? nx > 0 : ny > 0) ? -1 : 1;   // left / top side first
    cuts.push(c);
    rec([...refs, [c.id, first]], A); rec([...refs, [c.id, -first]], B);
  };
  rec([], tree);
  for (const e of extra) out.push(typeof e === "function" ? e(Wp, Hp) : e);
  for (const p of out) if (p.bleed && p.knife) { delete p.bleed; p.knife.base = bleedPoints(p.knife.base, Wp, Hp); }
  out.cuts = cuts;
  return out;
}
export function bleedPoints(base, Wp, Hp, near = 140) {
  return base.map(([x, y]) => [x < near ? 0 : Wp - x < near ? Wp : x, y < near ? 0 : Hp - y < near ? Hp : y]);
}
/* rows of relative widths and relative row heights as a cut tree in page fractions */
export function gridTree(rows, heights, Wp, Hp, margin, pg = page()) {
  const g = gutters(pg), avH = Hp - 2 * margin - g.h * (rows.length - 1), tot = heights.reduce((a, b) => a + b, 0);
  const colTree = (row, y0, y1) => {
    const avW = Wp - 2 * margin - g.v * (row.length - 1), sum = row.reduce((a, b) => a + b, 0);
    let x = margin, node = null; const xs = [];
    row.forEach((w, i) => { x += avW * w / sum; if (i < row.length - 1) { xs.push(x + g.v / 2); x += g.v; } });
    for (let i = xs.length - 1; i >= 0; i--) node = [xs[i] / Wp, y0 / Hp, xs[i] / Wp, y1 / Hp, null, node];
    return node;
  };
  let y = margin; const ys = [margin];
  heights.forEach((hh, i) => { y += avH * hh / tot; if (i < heights.length - 1) { ys.push(y + g.h / 2); y += g.h; } });
  ys.push(Hp - margin);
  let node = colTree(rows[rows.length - 1], ys[rows.length - 1], ys[rows.length]);
  for (let i = rows.length - 2; i >= 0; i--) node = [0, ys[i + 1] / Hp, 1, ys[i + 1] / Hp, colTree(rows[i], ys[i], ys[i + 1]), node];
  return node;
}
/* move the page's outer panel edges from the old margin to a new one; gutters stay as they are */
export function setMargin(pg, m) {
  const old = gutters(pg).margin, Wp = W(), Hp = H(), near = (v, t) => Math.abs(v - t) < 1.5;
  const mv = ([x, y]) => [near(x, old) ? m : near(x, Wp - old) ? Wp - m : x, near(y, old) ? m : near(y, Hp - old) ? Hp - m : y];
  for (const l of pg.layers) {
    if (l.type !== "panel") continue;
    if (l.knife) { l.knife.base = l.knife.base.map(mv); continue; }
    if (l.shape === "ellipse" || (l.shape !== "poly" && (l.radius || 0) >= 1)) continue;
    const P = panelBase(l).map(p => mv([p.x, p.y])).map(([x, y]) => ({ x, y }));
    setPanelPoly(l, P, l.shape === "poly");
  }
  gutters(pg).margin = m;
  derivePage(pg);
}

/* ---------------------------------------------------------------- editing cuts with the knife tool */
export function snapAngle(a, b, e) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); let t = Math.atan2(dy, dx);
  if (e.shiftKey) t = Math.round(t / (Math.PI / 12)) * Math.PI / 12;
  else if (S.showGuides && !e.ctrlKey) { const r = Math.round(t / (Math.PI / 2)) * Math.PI / 2; if (Math.abs(t - r) < 0.03) t = r; }
  return { x: a.x + Math.cos(t) * d, y: a.y + Math.sin(t) * d };
}
export function hitCut(p, pg = page()) {
  const tol = 9 / S.view.s;
  for (const c of [...(pg.cuts || [])].reverse()) {
    for (const [i, q] of [[0, c.a], [1, c.b]]) if (Math.hypot(p.x - q[0], p.y - q[1]) < tol * 1.3) return { cut: c, end: i };
    const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - c.a[0]) * dx + (p.y - c.a[1]) * dy) / L2));
    if (Math.hypot(p.x - c.a[0] - t * dx, p.y - c.a[1] - t * dy) < tol) return { cut: c, end: null };
  }
  return null;
}
export function drawCuts(ctx, px) {
  const pg = page();
  ctx.save();
  for (const c of pg.cuts || []) {
    const on = c.id === S.cut;
    ctx.strokeStyle = on ? "#ff4f7b" : "#ff4f7b99"; ctx.lineWidth = (on ? 2 : 1.25) * px; ctx.setLineDash(on ? [] : [8 * px, 6 * px]);
    ctx.beginPath(); ctx.moveTo(...c.a); ctx.lineTo(...c.b); ctx.stroke();
    if (on) { ctx.setLineDash([]); for (const q of [c.a, c.b]) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(q[0], q[1], 6.5 * px, 0, 7); ctx.fill(); ctx.stroke(); } }
  }
  const d = S.drag?.knife;
  if (d?.draw) {
    ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = "#4c8dff"; ctx.lineWidth = 2 * px;
    ctx.beginPath(); ctx.moveTo(d.a.x, d.a.y); ctx.lineTo(d.b.x, d.b.y); ctx.stroke();
    const ang = Math.round(((Math.atan2(d.b.y - d.a.y, d.b.x - d.a.x) * 180 / Math.PI) % 180 + 180) % 180);
    ctx.setLineDash([]); ctx.fillStyle = "#4c8dff"; ctx.font = `600 ${13 * px}px -apple-system, sans-serif`;
    ctx.fillText(ang + "°", d.b.x + 10 * px, d.b.y - 10 * px);
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- gutter controls (options bar and page properties) */
export function gutterControls(onChange, opts = {}) {
  const pg = page(), g = gutters(pg);
  const box = (t, tip, val, set) => h("label", { class: "gutin", title: tip }, t,
    h("input", { type: "number", min: 0, max: 400, step: 1, value: val, style: "width:58px", onchange: e => { set(Math.max(0, +e.target.value || 0)); onChange(); } }));
  const kids = [
    box("Tiers", "Gutter between tiers: the gap across a level cut, px (manga keeps these wider)", g.h, v => { g.h = v; derivePage(pg); }),
    box("Columns", "Gutter between panels side by side: the gap across a steep cut, px", g.v, v => { g.v = v; derivePage(pg); }),
    box("Margin", "Outer margin from the page edge to the panels, px (bleeds stay at the edge)", g.margin, v => setMargin(pg, v)),
  ];
  if (opts.all) kids.push(h("button", { title: "Use these gutters and margin on every page", onclick: () => {
    for (const p of S.doc.pages) if (p !== pg) { gutters(p).h = g.h; gutters(p).v = g.v; setMargin(p, g.margin); }
    onChange("Gutters on every page");
  } }, "All pages"));
  return kids;
}
