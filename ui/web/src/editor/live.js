/* Live Manga: panels whose characters move along OpenPose keyframes, like the moving photos in a wizard's
   newspaper. Off by default; a project turns it on with the "Live Manga" switch (doc.live = true).

   A live panel keeps, beside its normal still (l.image), a `live` block saved in project.json:

     live: { duration: 2, fps: 12, loop: "pingpong",            loop | pingpong | once
             bg:     { ref: "mp:shots/x/live/bg_123.png" },      background rendered with no characters
             actors: [{ id: "<pose char id>", ref: "mp:shots/x/live/actor_<id>_123.png" }],
                                                                 each character alone, cut out (RGBA, same frame)
             keys:   [{ t: 0, chars: [<pose chars>] }, { t: 1, chars: [...] }] }

   The pose a character was rendered in is the panel's scene pose (l.scene.pose, written by the Pose tab).
   Playback blends the keyframe poses joint by joint (bone directions turn, bone lengths are kept), then
   warps each character's cutout from its rendered skeleton to the blended one with a skinned triangle
   mesh, and lays it over the background. Nothing is rendered per frame: one background and one cutout
   per character make the whole loop. Panels without the renders yet preview their skeletons moving. */
import { $, h, clamp, deep, api, post } from "./core.js";
import { S, selL } from "./state.ts";
import { commit } from "./history.js";
import { requestDraw } from "./view.js";
import { getImg, waitImages } from "./images.js";
import { imageRect, drawLayer } from "./drawing.js";
import { startJob } from "./jobs.js";
import { save, renderFull } from "./project.js";
import { toast, status } from "./misc.js";
import { P } from "../pose/model.js";
import { project } from "../pose/geometry.js";
import { drawSkeleton } from "../pose/draw.js";
import { loadPoseLib } from "../pose/library.js";
import { setMode } from "../pose/open.js";

const L = { playing: false, t0: 0, last: 0, frames: new Map(), rigs: new Map(), raf: 0, scrub: null };
export const liveOn = () => !!S.doc?.live;
export const isLive = l => l?.type === "panel" && !!l.live;

/* ---------------------------------------------------------------- time */
function liveLocalT(lv, t) {
  const D = Math.max(0.1, lv.duration || 2);
  if (lv.loop === "once") return Math.min(t, D);
  if (lv.loop === "loop") return t % D;
  const u = t % (2 * D); return u <= D ? u : 2 * D - u;            // pingpong: there and back, no seam
}
const ease = u => u * u * (3 - 2 * u);

/* ---------------------------------------------------------------- pose blending */
// COCO-18 parents (neck is the root); hands hang from the wrists, 21 points each
const PARENT = [1, -1, 1, 2, 3, 1, 5, 6, 1, 8, 9, 1, 11, 12, 0, 0, 14, 15];
const HPARENT = [-1, 0, 1, 2, 3, 0, 5, 6, 7, 0, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
function slerpDir(a, b, u) {                       // unit-direction blend that keeps a bone's length steady
  const la = len3(a) || 1e-9, lb = len3(b) || 1e-9;
  const A = a.map(v => v / la), B = b.map(v => v / lb);
  const dot = clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1), th = Math.acos(dot);
  let d;
  if (th < 1e-4) d = A.map((v, i) => v + (B[i] - v) * u);
  else { const s = Math.sin(th), wa = Math.sin((1 - u) * th) / s, wb = Math.sin(u * th) / s; d = A.map((v, i) => v * wa + B[i] * wb); }
  const l = la + (lb - la) * u, n = len3(d) || 1;
  return d.map(v => v / n * l);
}
function blendChain(pa, pb, parent, u, rootA, rootB) {
  const out = new Array(pa.length);
  const order = [...pa.keys()].sort((i, j) => depth(parent, i) - depth(parent, j));
  for (const i of order) {
    const p = parent[i];
    if (p < 0) { const ra = rootA || pa[i], rb = rootB || pb[i]; out[i] = ra.map((v, k) => v + (rb[k] - v) * u); continue; }
    const d = slerpDir(sub3(pa[i], pa[p]), sub3(pb[i], pb[p]), u);
    out[i] = [out[p][0] + d[0], out[p][1] + d[1], out[p][2] + d[2]];
  }
  return out;
}
function depth(parent, i) { let n = 0; while (parent[i] >= 0) { i = parent[i]; n++; } return n; }
function blendPose(a, b, u) {
  if (!b || a === b || u <= 0) return a;
  if (u >= 1) return b;
  const body = blendChain(a.body, b.body, PARENT, u);
  const hands = [0, 1].map(s => {
    const ha = a.hands?.[s], hb = b.hands?.[s];
    if (!ha?.length || !hb?.length) return (u < 0.5 ? ha : hb) || [];
    // the hand's own shape blends, then rides on the blended wrist (left hand on 7, right on 4)
    const w = body[s === 0 ? 7 : 4], wa = a.body[s === 0 ? 7 : 4], wb = b.body[s === 0 ? 7 : 4];
    const rel = blendChain(ha.map(p => sub3(p, wa)), hb.map(p => sub3(p, wb)), HPARENT, u);
    return rel.map(p => [p[0] + w[0], p[1] + w[1], p[2] + w[2]]);
  });
  return { body, hands };
}
const NUM = ["x", "y", "scale", "yaw", "pitch", "roll"];
function blendChar(ca, cb, u) {
  const c = { ...ca };
  for (const k of NUM) c[k] = (ca[k] ?? 0) + ((cb[k] ?? ca[k] ?? 0) - (ca[k] ?? 0)) * u;
  c.flip = u < 0.5 ? ca.flip : cb.flip;
  c.hidden = u < 0.5 ? ca.hidden : cb.hidden;
  const keys = new Set([...Object.keys(ca.edits || {}), ...Object.keys(cb.edits || {})]);
  c.edits = {};
  for (const k of keys) { const a = ca.edits?.[k] || [0, 0], b = cb.edits?.[k] || [0, 0]; c.edits[k] = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; }
  return c;
}
/* the pose keys of one character at local time tt: [{c, pose}] blended between the two keys around tt */
function liveKeys(l) {
  const base = { t: 0, chars: l.scene?.pose?.chars || [] };
  const keys = (l.live.keys || []).slice().sort((a, b) => a.t - b.t);
  return keys.length && keys[0].t <= 0 ? keys : [base, ...keys];
}
export function charAt(l, id, tt) {
  const keys = liveKeys(l).map(k => ({ t: k.t, c: k.chars.find(c => c.id === id) })).filter(k => k.c);
  if (!keys.length) return null;
  let a = keys[0], b = keys[0];
  for (const k of keys) { if (k.t <= tt) a = k; if (k.t >= tt) { b = k; break; } b = k; }
  const u = b.t > a.t ? ease(clamp((tt - a.t) / (b.t - a.t), 0, 1)) : 0;
  const pa = P.byId.get(a.c.pose), pb = P.byId.get(b.c.pose) || pa;
  if (!pa) return null;
  return { c: blendChar(a.c, b.c, u), pose: blendPose(pa, pb, u) };
}
function projectPose(c, pose, W, H) {                  // pose.js's projection with an in-between pose
  const id = "\u0000live";
  P.byId.set(id, pose);
  try { return project({ ...c, pose: id, edits: c.edits || {} }, W, H); } finally { P.byId.delete(id); }
}

/* ---------------------------------------------------------------- skinning */
// the mesh rig is shared with the format's reference player (livemanga.js), so the editor previews
// exactly what a reader site will show
const LM = () => window.LiveManga;               // public/livemanga.js, loaded by index.html
const buildRig = (...a) => LM().buildRig(...a), drawRig = (...a) => LM().drawRig(...a);

/* ---------------------------------------------------------------- frames */
function rawImg(ref) {                                  // full-size image for pixel work (not the view-size levels)
  return getImg(ref, 0);
}
export function liveFrameAt(l, t) {
  const sc = l.scene?.pose, lv = l.live;
  if (!sc || !P.lib) return null;
  const bg = lv.bg?.ref ? rawImg(lv.bg.ref) : (l.image ? rawImg(l.image.ref) : null);
  // the frame is the size of the renders; the pose canvas sits in it the way the pipeline fits pose.png
  // (scaled to fit, centred, see mp/studio.prepare_pose)
  const RW = bg?.naturalWidth || l.image?.iw || sc.w, RH = bg?.naturalHeight || l.image?.ih || sc.h;
  const s = Math.min(RW / sc.w, RH / sc.h), ox = (RW - sc.w * s) / 2, oy = (RH - sc.h * s) / 2;
  const fit = pts => pts.map(p => [p[0] * s + ox, p[1] * s + oy]);
  const tt = liveLocalT(lv, t);
  let f = L.frames.get(l.id);
  if (!f) { f = document.createElement("canvas"); L.frames.set(l.id, f); }
  if (f.width !== RW || f.height !== RH) { f.width = RW; f.height = RH; }
  const g = f.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, RW, RH);
  if (bg) g.drawImage(bg, 0, 0, RW, RH); else { g.fillStyle = "#222"; g.fillRect(0, 0, RW, RH); }
  const chars = [...sc.chars].sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const c0 of chars) {
    if (c0.hidden) continue;
    const at = charAt(l, c0.id, tt); if (!at) continue;
    const pr = projectPose(at.c, at.pose, sc.w, sc.h); if (!pr) continue;
    const actor = (lv.actors || []).find(a => a.id === c0.id);
    if (actor?.ref) {
      const img = rawImg(actor.ref);
      if (!img) return null;                                   // still loading: show the still meanwhile
      const key = actor.ref + "|" + RW + "x" + RH + "|" + JSON.stringify([c0.pose, c0.x, c0.y, c0.scale, c0.yaw, c0.pitch, c0.roll, c0.flip, c0.edits]);
      let rig = L.rigs.get(key);
      if (rig === undefined) {
        const bind = project(c0, sc.w, sc.h);
        rig = bind ? buildRig(img, fit(bind.body)) : null;
        L.rigs.set(key, rig);
      }
      if (rig) { g.setTransform(1, 0, 0, 1, 0, 0); drawRig(g, rig, fit(pr.body)); continue; }
    }
    g.setTransform(s, 0, 0, s, ox, oy);                        // no cutout yet: the skeleton moves
    drawSkeleton(g, pr, Math.min(sc.w, sc.h) / 1024, { alpha: 0.9 });
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  return f;
}
/* app.js asks this for a panel's picture while Live Manga plays or scrubs; null = draw the still */
export function liveImage(l) {
  if (!liveOn() || !isLive(l) || (!L.playing && !(L.scrub && L.scrub.id === l.id))) return null;
  const t = L.scrub && L.scrub.id === l.id ? L.scrub.t : (performance.now() - L.t0) / 1000;
  return liveFrameAt(l, t);
}

/* ---------------------------------------------------------------- playback */
function liveTick(now) {
  if (!L.playing) return;
  const fps = Math.max(...S.doc.pages[S.page].layers.filter(isLive).map(l => l.live.fps || 12), 12);
  if (now - L.last >= 1000 / fps - 2) { L.last = now; requestDraw(); }
  L.raf = requestAnimationFrame(liveTick);
}
export async function livePlay(on = !L.playing) {
  if (on) { await loadPoseLib(); L.playing = true; L.t0 = performance.now(); L.raf = requestAnimationFrame(liveTick); }
  else { L.playing = false; cancelAnimationFrame(L.raf); requestDraw(); }
  renderLiveBar();
}

/* ---------------------------------------------------------------- editing */
function liveDefaults(l) {
  return { duration: 2, fps: 12, loop: "pingpong", bg: null, actors: [], keys: [] };
}
export function makeLive(l) {
  if (!l || l.type !== "panel") return toast("Select a panel", "err");
  if (!l.scene?.pose?.chars?.length) return toast("Pose this panel first (Pipeline › Pose the selected panel), so its characters have skeletons", "err");
  l.live = l.live || liveDefaults(l);
  commit("Live panel"); renderLiveBar();
}
/* open the Pose studio on one keyframe of a live panel; saving writes the key back, not a shot */
export async function editLiveKey(l, t) {
  await loadPoseLib();
  const lv = l.live, sc = l.scene.pose;
  let k = (lv.keys || []).find(q => Math.abs(q.t - t) < 1e-3);
  const chars = k ? k.chars : sc.chars.map(c => {           // a new key starts from the pose at that moment
    const at = charAt(l, c.id, t); return at ? { ...at.c, pose: c.pose } : deep(c);
  });
  P.liveKey = { panel: l.id, t };
  P.shot = l.shot || ""; P.panel = l.id;
  P.scene = { w: sc.w, h: sc.h, prompt: l.scene.prompt || "", chars: deep(chars) };
  P.sel = null; P.undo = []; P.redo = []; P.snap = JSON.stringify(P.scene); P.dirty = false;
  setMode("pose");
  status(`Live key at ${t.toFixed(2)} s: pose the characters, then ⌘S (or Save key) to keep it`);
}
export function saveLiveKey() {
  const lk = P.liveKey; if (!lk) return false;
  const l = S.doc.pages.flatMap(p => p.layers).find(q => q.id === lk.panel);
  if (!l?.live) { P.liveKey = null; return false; }
  const ids = new Set(l.scene.pose.chars.map(c => c.id));
  const chars = deep(P.scene.chars.filter(c => ids.has(c.id)));
  if (lk.t <= 0) toast("The 0 s pose is the rendered pose; change it with Save to shot and re-render", "err");
  else {
    l.live.keys = (l.live.keys || []).filter(q => Math.abs(q.t - lk.t) >= 1e-3);
    l.live.keys.push({ t: +lk.t.toFixed(3), chars }); l.live.keys.sort((a, b) => a.t - b.t);
    commit(`Live key ${lk.t.toFixed(2)} s`);
    toast(`Saved key at ${lk.t.toFixed(2)} s`, "ok");
  }
  P.dirty = false; P.liveKey = null; setMode("page"); renderLiveBar();
  return true;
}

/* ---------------------------------------------------------------- export (Live Manga format 1.0) */
/* Everything a reader site needs, baked: per page the still and a transparent overlay of what sits
   above the panels; per moving panel its background, cutouts, the skeleton each cutout was drawn in
   and the skeleton for every frame. See docs/LIVEMANGA_FORMAT.md. */
function liveFrames(l) {
  const lv = l.live, sc = l.scene.pose, fps = Math.max(1, lv.fps || 12), D = Math.max(0.1, lv.duration || 2);
  const cyc = lv.loop === "pingpong" ? 2 * D : D, n = Math.max(1, Math.round(cyc * fps));
  return { fps, n, loop: lv.loop === "once" ? "once" : "loop", times: [...Array(n).keys()].map(f => liveLocalT(lv, f / fps)) };
}
function liveExportPanel(l, pid) {
  const lv = l.live, sc = l.scene?.pose;
  if (!sc || !lv?.bg?.ref || !(lv.actors || []).some(a => a.ref) || !l.image) return null;
  const RW = l.image.iw, RH = l.image.ih;
  const s = Math.min(RW / sc.w, RH / sc.h), ox = (RW - sc.w * s) / 2, oy = (RH - sc.h * s) / 2;
  const fit = pts => pts.map(p => [+(p[0] * s + ox).toFixed(1), +(p[1] * s + oy).toFixed(1)]);
  const fr = liveFrames(l), r = imageRect(l);
  const files = { [`panels/${pid}/bg.png`]: lv.bg.ref };
  const actors = [];
  [...sc.chars].sort((a, b) => (a.z || 0) - (b.z || 0)).forEach((c0, k) => {
    const act = (lv.actors || []).find(a => a.id === c0.id);
    if (c0.hidden || !act?.ref) return;
    const bind = project(c0, sc.w, sc.h); if (!bind) return;
    const frames = fr.times.map(tt => { const at = charAt(l, c0.id, tt); const pr = at && projectPose(at.c, at.pose, sc.w, sc.h); return fit((pr || bind).body); });
    const name = `panels/${pid}/actor_${k + 1}.png`;
    files[name] = act.ref;
    actors.push({ image: name, bind: fit(bind.body), frames });
  });
  if (!actors.length) return null;
  return { files, panel: { id: pid, clip: [l.x, l.y, l.w, l.h].map(v => Math.round(v)), art: { width: RW, height: RH, rect: [r.x, r.y, r.w, r.h].map(v => +v.toFixed(1)), flip: !!l.image.flip },
    fps: fr.fps, loop: fr.loop, background: `panels/${pid}/bg.png`, actors } };
}
export async function exportLiveManga() {
  if (!S.name) { await save(); if (!S.name) return; }
  await loadPoseLib();
  status("Exporting Live Manga…");
  try {
    const man = { format: "livemanga", version: "1.0", title: S.doc.title || S.name, reading: S.doc.reading || "rtl",
      page: { width: S.doc.width, height: S.doc.height }, generator: "MangaMaker", pages: [] };
    const images = {}, copies = {};
    for (let i = 0; i < S.doc.pages.length; i++) {
      const pg = S.doc.pages[i], dir = `pages/${String(i + 1).padStart(2, "0")}`;
      images[`${dir}/base.png`] = (await renderFull(i)).toDataURL("image/png");
      const entry = { base: `${dir}/base.png`, panels: [] };
      const live = pg.layers.map((l, j) => [l, j]).filter(([l]) => isLive(l) && l.visible);
      for (const [l] of live) {
        const out = liveExportPanel(l, l.id);
        if (out) { entry.panels.push(out.panel); Object.assign(copies, out.files); }
      }
      if (entry.panels.length) {                   // everything above the lowest moving panel, without panel art
        const from = Math.min(...live.filter(([l]) => entry.panels.some(p => p.id === l.id)).map(([, j]) => j));
        const c = document.createElement("canvas"); c.width = S.doc.width; c.height = S.doc.height;
        const g = c.getContext("2d");
        const draw = () => { g.clearRect(0, 0, c.width, c.height); pg.layers.slice(from).forEach(l => drawLayer(g, l.type === "panel" ? { ...l, image: null, fill: "rgba(0,0,0,0)" } : l, { export: true, rs: 1 })); };
        draw(); await waitImages(); draw();
        images[`${dir}/overlay.png`] = c.toDataURL("image/png");
        entry.overlay = `${dir}/overlay.png`;
      }
      man.pages.push(entry);
    }
    const r = await post(`/api/export/livemanga?name=${encodeURIComponent(S.name)}`, { manifest: man, images, copies });
    const moving = man.pages.reduce((n, p) => n + p.panels.length, 0);
    const msg = `Live Manga: ${man.pages.length} page${man.pages.length > 1 ? "s" : ""}, ${moving} moving panel${moving === 1 ? "" : "s"} → ${r.path}`;
    toast(msg, "ok"); status(msg);
    return r;
  } catch (e) { toast(e.message, "err"); }
}

/* ---------------------------------------------------------------- the Live bar */
export function renderLiveBar() {
  let bar = $("#livebar");
  const show = liveOn() && S.mode !== "pose";
  if (!bar) { bar = h("div", { id: "livebar" }); $("#center").append(bar); }
  bar.hidden = !show; if (!show) return;
  const l = selL(), live = isLive(l) ? l : null;
  bar.replaceChildren(...[
    h("span", { class: "livetag" }, "LIVE"),
    h("button", { onclick: () => livePlay(), title: "Play every live panel on this page" }, L.playing ? "❚❚ Pause" : "▶ Play"),
    h("button", { onclick: () => exportLiveManga(), title: "Export the chapter in the Live Manga format (manga.json + images + a reader) for any website" }, "Export .livemanga"),
    live ? liveTimeline(live) : h("span", { class: "muted" }, l?.type === "panel" ? "" : "Select a panel to give it moving characters"),
    l?.type === "panel" && !live ? h("button", { onclick: () => makeLive(l) }, "Make panel live") : null,
    live ? h("button", { onclick: () => { delete l.live; commit("Panel no longer live"); renderLiveBar(); }, title: "Back to a still panel (keeps its picture)" }, "Make still") : null,
  ].filter(Boolean));
}
function liveTimeline(l) {
  const lv = l.live, D = lv.duration || 2;
  const track = h("div", { class: "livetrack", title: "Click to scrub; double-click to add or edit a keyframe" });
  const mark = t => h("i", { class: "livekey" + (t === 0 ? " base" : ""), style: `left:${t / D * 100}%`, title: t === 0 ? "0 s: the rendered pose" : `${t.toFixed(2)} s: double-click to edit, right-click to delete`,
    oncontextmenu: e => { e.preventDefault(); if (!t) return; lv.keys = lv.keys.filter(q => q.t !== t); commit("Live key removed"); renderLiveBar(); } });
  track.append(mark(0), ...(lv.keys || []).filter(k => k.t > 0).map(k => mark(k.t)));
  const at = e => { const r = track.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * D; };
  track.onpointerdown = e => {
    track.setPointerCapture(e.pointerId);
    const go = ev => { L.scrub = { id: l.id, t: at(ev) }; requestDraw(); };
    go(e); track.onpointermove = go;
    track.onpointerup = () => { track.onpointermove = null; };
  };
  track.ondblclick = e => { const t = at(e), near = (lv.keys || []).find(k => Math.abs(k.t - t) / D < 0.03); editLiveKey(l, near ? near.t : +t.toFixed(2)); };
  const num = (k, label, min, max, step) => h("label", {}, label, h("input", { type: "number", min, max, step, value: lv[k], onchange: e => { lv[k] = clamp(+e.target.value || lv[k], min, max); commit("Live " + k); renderLiveBar(); } }));
  const sel = h("select", { onchange: e => { lv.loop = e.target.value; commit("Live loop"); } },
    ...["pingpong", "loop", "once"].map(v => h("option", { value: v, selected: lv.loop === v }, { pingpong: "there and back", loop: "loop", once: "play once" }[v])));
  const parts = [lv.bg?.ref ? "background ✓" : "background: still", `${(lv.actors || []).filter(a => a.ref).length}/${l.scene.pose.chars.filter(c => !c.hidden).length} cutouts`];
  const bgp = h("input", { type: "text", class: "livebgp", placeholder: "Background with nobody in it, e.g. empty classroom at sunset", value: lv.bgPrompt || "",
    title: "Prompt for the background layer (defaults to the shot prompt); describe the place, not the people",
    onchange: e => { lv.bgPrompt = e.target.value.trim(); commit("Live background prompt"); } });
  return h("div", { class: "liverow" }, track, num("duration", "s", 0.5, 8, 0.5), num("fps", "fps", 4, 24, 1), sel,
    bgp,
    h("button", { onclick: () => liveRender(l), title: "Render the background without characters and each character alone (cut out) on the pod" }, "Render layers"),
    h("span", { class: "muted" }, parts.join(" · ")));
}
function liveRender(l) {
  if (!l.shot) return toast("This panel has no shot yet: pose it first", "err");
  if (S.pod && !S.pod.running) toast("The pod isn't running: Pipeline › Start pod first", "err");
  startJob({ cmd: "live", shot: l.shot, bg_prompt: l.live.bgPrompt || "", chars: ["bg", ...l.scene.pose.chars.filter(c => !c.hidden).map(c => c.id)] })
    .then(id => { if (id && S.jobs[id]) S.jobs[id].after = code => { if (code === 0) liveCollect(l); }; });
}
async function liveCollect(l) {
  try {
    const r = await api(`/api/live/layers?shot=${encodeURIComponent(l.shot)}`);
    if (r.bg) l.live.bg = { ref: r.bg };
    l.live.actors = Object.entries(r.actors || {}).map(([id, ref]) => ({ id, ref }));
    L.rigs.clear(); commit("Live layers"); renderLiveBar();
  } catch (e) { toast(e.message, "err"); }
}
export function setLive(on) {
  S.doc.live = !!on; if (!on) livePlay(false);
  $("#livebtn")?.classList.toggle("on", !!on);
  commit(on ? "Live Manga on" : "Live Manga off"); renderLiveBar();
}

/* ---------------------------------------------------------------- wiring */
export function init_editor_live() {
  document.head.append(h("style", {}, `
    #livebtn.on { background: var(--accent2); border-color: var(--accent2); color: #fff; }
    #center { position: relative; }
    #livebar { position: absolute; left: 12px; right: 12px; bottom: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
      padding: 8px 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 6px 24px #0008; z-index: 5; }
    #livebar .livetag { font-weight: 700; color: var(--accent2); letter-spacing: .08em; }
    #livebar .liverow { display: flex; gap: 8px; align-items: center; flex: 1; flex-wrap: wrap; min-width: 0; }
    #livebar .livetrack { position: relative; flex: 1; min-width: 160px; height: 22px; border-radius: 6px; background: var(--panel2); cursor: ew-resize; }
    #livebar .livekey { position: absolute; top: 3px; width: 10px; height: 16px; margin-left: -5px; border-radius: 3px; background: var(--accent2); cursor: pointer; }
    #livebar .livekey.base { background: var(--accent); }
    #livebar label { display: flex; gap: 4px; align-items: center; }
    #livebar input[type=number] { width: 54px; }
    #livebar .livebgp { flex: 1 1 220px; min-width: 160px; }
    #livebar .muted { opacity: .65; font-size: 12px; }
  `));
  const btn = h("button", { id: "livebtn", class: "pill", title: "Live Manga: characters that move along OpenPose keyframes", onclick: () => setLive(!liveOn()) }, "✦ Live Manga");
  $("#modetabs")?.after(btn);
  const sync = () => { if (L.scrub && L.scrub.id !== S.sel) { L.scrub = null; requestDraw(); } $("#livebtn")?.classList.toggle("on", liveOn()); renderLiveBar(); };
  setInterval(() => { const k = `${!!S.doc?.live}|${S.sel}|${S.mode}|${S.page}`; if (k !== L.k) { L.k = k; sync(); } }, 250);
}
