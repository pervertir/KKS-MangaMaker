import { $, api, clamp, h } from "../editor/core.js";
import { status, toast } from "../editor/misc.js";
import { drawSkeleton } from "./draw.js";
import { bounds, project } from "./geometry.js";
import { P } from "./model.js";
import { newChar, pcommit, pcur } from "./scene.js";
import { registerGroup, useGroup } from "./side.js";

/* ---------------------------------------------------------------- library */
export async function loadPoseLib() {
  if (P.lib) return;
  status("Loading poses…");
  try {
    const r = await api("/api/poses");
    P.lib = r.poses;
    P.byId = new Map(P.lib.map(p => [p.id, p]));
    P.lib.filter(p => p.members).forEach(registerGroup);
    // sorted by what the pose is, not who made it: built-in ones first inside each type
    const order = r.kinds || [];
    P.lib.sort((a, b) => (order.indexOf(a.kind) - order.indexOf(b.kind)) || ((a.pack === "Basic" ? 0 : 1) - (b.pack === "Basic" ? 0 : 1)));
    P.packs = order.filter(k => P.lib.some(p => p.kind === k));
  } catch (e) { toast("Pose library: " + e.message, "err"); P.lib = []; }
  status("");
}
export const thumbObs = new IntersectionObserver(ents => {
  for (const en of ents) if (en.isIntersecting) { paintThumb(en.target); thumbObs.unobserve(en.target); }
}, { root: null, rootMargin: "200px" });
export function paintThumb(cv) {
  const pose = P.byId.get(cv.dataset.id); if (!pose) return;
  const g = cv.getContext("2d"), W = cv.width, H = cv.height;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  if (pose.members) {                                  // group: every figure where it stood, fitted to the tile
    const a = pose.aspect || 0.7, fw = Math.min(W, H * a), fh = fw / a, ox = (W - fw) / 2, oy = (H - fh) / 2;
    pose.members.forEach((m, i) => {
      const pr = project({ pose: `${pose.id}#${i}`, x: m.x, y: m.y, scale: m.scale, yaw: 0, pitch: 0, roll: 0, flip: false, edits: {} }, fw, fh);
      if (!pr) return;
      const sh = p => [p[0] + ox, p[1] + oy, p[2]];
      drawSkeleton(g, { body: pr.body.map(sh), hands: pr.hands.map(hd => hd.map(sh)), k: pr.k, hide: pr.miss, hoff: pr.hoff }, 0.4, { hands: false });
    });
    return;
  }
  const fake = { pose: pose.id, x: 0.5, y: 0.5, scale: 1, yaw: 0, pitch: 0, roll: 0, flip: false, edits: {} };
  let pr = project(fake, W, H); const b = bounds(pr);       // fit the figure into the tile
  const f = Math.min(W * 0.9 / b.w, H * 0.9 / b.h);
  fake.scale = f; pr = project(fake, W, H); const b2 = bounds(pr);
  fake.x = 0.5 + (W / 2 - (b2.x + b2.w / 2)) / W; fake.y = 0.5 + (H / 2 - (b2.y + b2.h / 2)) / H;
  drawSkeleton(g, project(fake, W, H), 0.5, { hands: false });
}
export function renderPoseLib() {
  const box = $("#pslib"); if (!box) return;
  const list = $("#pslist"), q = P.filter.q.toLowerCase();
  const sel = $("#pspack");
  const hasMine = P.lib.some(p => p.pack === "My poses");
  const opts = [["", `All types (${P.lib.length})`], ...(hasMine ? [["@mine", `My poses (${P.lib.filter(p => p.pack === "My poses").length})`]] : []),
    ...P.packs.map(k => [k, `${k} (${P.lib.filter(p => p.kind === k).length})`])];
  if (sel.dataset.sig !== opts.map(o => o[1]).join("|")) {
    sel.innerHTML = ""; for (const [v, t] of opts) sel.append(h("option", { value: v }, t));
    sel.dataset.sig = opts.map(o => o[1]).join("|"); sel.value = P.filter.pack;
  }
  list.innerHTML = "";
  const f = P.filter.pack;
  const hits = P.lib.filter(p => (!f || (f === "@mine" ? p.pack === "My poses" : p.kind === f)) && (!q || (p.name + " " + p.kind).toLowerCase().includes(q)));
  let lastGroup = null;
  for (const p of hits.slice(0, 600)) {
    const grp = p.kind || "Other";
    if (grp !== lastGroup && f !== grp) { list.append(h("div", { class: "psgroup" }, grp)); lastGroup = grp; }
    const cv = h("canvas", { width: 96, height: 128, "data-id": p.id });
    const el = h("div", { class: "pstile", title: `${p.name} · ${grp}\nClick: use for the selected character (or add one). Drag onto the canvas to add.`,
      draggable: true, onclick: () => p.members ? useGroup(p) : usePose(p.id) }, cv, h("div", { class: "cap" }, (p.members ? `👥${p.members.length} ` : "") + p.name));
    el.addEventListener("dragstart", e => e.dataTransfer.setData("application/x-pose", p.id));
    list.append(el); thumbObs.observe(cv);
  }
  if (hits.length > 600) list.append(h("div", { class: "hint" }, `${hits.length - 600} more: pick a type or search.`));
  if (!hits.length) list.append(h("div", { class: "hint" }, "No poses match."));
}
export function usePose(id, at) {
  let c = pcur();
  if (!c || at) {
    c = newChar(id, at ? at.x / P.scene.w : 0.5, at ? Math.min(0.98, at.y / P.scene.h + 0.4) : 0.92);
    if (!at && P.scene.chars.length) c.x = clamp(0.25 + 0.5 * (P.scene.chars.length % 3) / 2, 0.1, 0.9);
    P.scene.chars.push(c); P.sel = c.id; pcommit("Character added");
  } else { c.pose = id; c.edits = {}; c.show = []; c.cut = []; pcommit("Pose: " + (P.byId.get(id)?.name || id)); }
}
