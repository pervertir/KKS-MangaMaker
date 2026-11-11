/* Pose studio: several characters as OpenPose skeletons on one canvas, posed from the pose library
   (3D keypoints, so each figure can be turned, tilted and mirrored), then fine-tuned joint by joint.
   "Save to shot" writes pose.png + pose_scene.json into shots/<name>/ and the render runs on the pod
   exactly like a Studio capture, so no game is needed. Loaded after app.js and uses its helpers. */

const P = {
  lib: null, byId: new Map(), packs: [], filter: { q: "", pack: "" },
  scene: null, sel: null, joint: null, undo: [], redo: [], shot: "", panel: null,
  view: { s: 1, ox: 0, oy: 0 }, drag: null, showHands: true, dirty: false,
};

/* OpenPose drawing tables (COCO-18 body as ControlNet's preprocessors draw it) */
const LIMBS = [[1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17]];
const KCOL = ["#ff0000", "#ff5500", "#ffaa00", "#ffff00", "#aaff00", "#55ff00", "#00ff00", "#00ff55", "#00ffaa", "#00ffff", "#00aaff", "#0055ff", "#0000ff", "#5500ff", "#aa00ff", "#ff00ff", "#ff00aa", "#ff0055"];
const HAND_EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20]];
const JOINT_NAMES = ["nose", "neck", "right shoulder", "right elbow", "right wrist", "left shoulder", "left elbow", "left wrist", "right hip", "right knee",
  "right ankle", "left hip", "left knee", "left ankle", "right eye", "left eye", "right ear", "left ear"];
// mirrored figure: anatomical left <-> right
const SWAP_BODY = [0, 1, 5, 6, 7, 2, 3, 4, 11, 12, 13, 8, 9, 10, 15, 14, 17, 16];
// dragging these joints carries their dependants along
const CARRY = { 0: [14, 15, 16, 17], 4: ["hR"], 7: ["hL"], 1: [] };
const ASPECTS = [["832x1216", "Portrait 2:3 (832×1216)"], ["896x1152", "Portrait 7:9 (896×1152)"], ["1024x1024", "Square (1024×1024)"],
  ["1152x896", "Landscape 9:7 (1152×896)"], ["1216x832", "Landscape 3:2 (1216×832)"], ["768x1344", "Tall (768×1344)"], ["1344x768", "Wide (1344×768)"]];
const FIG_H = 1.75;    // metres that a scale-1 figure spans over the canvas height

/* ---------------------------------------------------------------- scene model */
function newScene(w = 832, h = 1216) { return { w, h, prompt: "", chars: [] }; }
function newChar(poseId, x = 0.5, y = 0.92) {
  const n = (P.scene?.chars.length || 0) + 1;
  return { id: uid(), pose: poseId, name: "", series: "", tags: "", x, y, scale: 0.85, yaw: 0, pitch: 0, roll: 0, flip: false, hidden: false, edits: {}, label: `Character ${n}` };
}
const pcur = () => P.scene.chars.find(c => c.id === P.sel) || null;
function pcommit(msg) {
  P.undo.push(P.snap); if (P.undo.length > 200) P.undo.shift(); P.redo = [];
  P.snap = JSON.stringify(P.scene); P.dirty = true;
  if (msg) status(msg);
  pdraw(); renderPoseSide();
}
function prestore(js) { P.scene = JSON.parse(js); P.snap = js; if (!pcur()) P.sel = null; pdraw(); renderPoseSide(); }
function pundo() { if (!P.undo.length) return; P.redo.push(P.snap); prestore(P.undo.pop()); status("Undo"); }
function predo() { if (!P.redo.length) return; P.undo.push(P.snap); prestore(P.redo.pop()); status("Redo"); }

/* ---------------------------------------------------------------- geometry */
/* 3D pose -> canvas pixels for one character. Returns {body[18], hands[2][21], k}. Mirroring swaps the
   anatomical sides so the colours stay correct (a mirrored right arm is drawn as a left arm). */
function project(c, W, H) {
  const pose = P.byId.get(c.pose); if (!pose) return null;
  const k = c.scale * H / FIG_H;
  const yaw = c.yaw * Math.PI / 180, pit = c.pitch * Math.PI / 180, rol = c.roll * Math.PI / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit), cr = Math.cos(rol), sr = Math.sin(rol);
  const hipY = (pose.body[8][1] + pose.body[11][1]) / 2;
  const ax = c.x * W, ay = c.y * H;
  const tf = ([x, y, z]) => {
    if (c.flip) x = -x;
    let X = x * cy + z * sy, Z = -x * sy + z * cy;          // yaw around the vertical axis
    let Y = y - hipY; const Y2 = Y * cp - Z * sp; Z = Y * sp + Z * cp; Y = Y2 + hipY;  // pitch around the hips
    const sx = X * k, syy = -(Y - hipY) * k;                  // screen, relative to the hips
    return [ax + sx * cr - syy * sr, ay - hipY * k + sx * sr + syy * cr, Z];
  };
  let body = pose.body.map(tf);
  let hands = (pose.hands || [[], []]).map(hd => hd.map(tf));      // [left, right]
  if (c.flip) { body = SWAP_BODY.map(i => body[i]); hands = [hands[1], hands[0]]; }
  const off = (key) => { const e = c.edits[key]; return e ? [e[0] * k, e[1] * k] : [0, 0]; };
  const add = (p, d) => [p[0] + d[0], p[1] + d[1], p[2]];
  body = body.map((p, i) => {
    let d = off(i);
    for (const [src, deps] of Object.entries(CARRY)) if (deps.includes(i)) { const o = off(+src); d = [d[0] + o[0], d[1] + o[1]]; }
    return add(p, d);
  });
  hands = hands.map((hd, s) => {
    const wrist = off(s === 0 ? 7 : 4);
    return hd.map((p, i) => { const o = off(`h${s ? "R" : "L"}${i}`); return add(p, [wrist[0] + o[0], wrist[1] + o[1]]); });
  });
  return { body, hands, k };
}
function bounds(pr) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of [...pr.body, ...pr.hands.flat()]) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const pad = 0.06 * pr.k;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

/* ---------------------------------------------------------------- OpenPose drawing */
function drawSkeleton(g, pr, unit, opt = {}) {
  const stick = Math.max(1.5, unit * 4), rad = Math.max(1.5, unit * 4);
  g.save();
  g.globalAlpha = opt.alpha ?? 1;
  for (let i = 0; i < LIMBS.length; i++) {               // limbs: soft ellipses, like the preprocessors
    const [a, b] = LIMBS[i], A = pr.body[a], B = pr.body[b];
    if (!A || !B) continue;
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, len = Math.hypot(B[0] - A[0], B[1] - A[1]) / 2, ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
    g.globalAlpha = (opt.alpha ?? 1) * 0.6; g.fillStyle = KCOL[i];
    g.beginPath(); g.ellipse(mx, my, Math.max(len, 0.1), stick, ang, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = opt.alpha ?? 1;
  pr.body.forEach((p, i) => { g.fillStyle = KCOL[i]; g.beginPath(); g.arc(p[0], p[1], rad, 0, Math.PI * 2); g.fill(); });
  if (opt.hands !== false) for (const hd of pr.hands) {
    if (!hd.length) continue;
    g.lineWidth = Math.max(1, unit * 2);
    HAND_EDGES.forEach(([a, b], i) => {
      g.strokeStyle = `hsl(${(i / HAND_EDGES.length) * 360},100%,50%)`;
      g.beginPath(); g.moveTo(hd[a][0], hd[a][1]); g.lineTo(hd[b][0], hd[b][1]); g.stroke();
    });
    g.fillStyle = "#0000ff";
    for (const p of hd) { g.beginPath(); g.arc(p[0], p[1], Math.max(1, unit * 2), 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
}
/* the pose image ControlNet gets: black, every visible figure, nothing else */
function renderPosePNG() {
  const { w, h } = P.scene, c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  const unit = Math.min(w, h) / 1024;
  for (const ch of P.scene.chars) { if (ch.hidden) continue; const pr = project(ch, w, h); if (pr) drawSkeleton(g, pr, unit, { hands: P.showHands }); }
  return c;
}

/* ---------------------------------------------------------------- view */
const pcv = () => $("#pscanvas");
function pfit() {
  const st = $("#psstage"), r = st.getBoundingClientRect(), cv = pcv(), dpr = devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const s = Math.min((r.width - 40) / P.scene.w, (r.height - 40) / P.scene.h);
  P.view = { s, ox: (r.width - P.scene.w * s) / 2, oy: (r.height - P.scene.h * s) / 2 };
  pdraw();
}
const pToScene = (sx, sy) => ({ x: (sx - P.view.ox) / P.view.s, y: (sy - P.view.oy) / P.view.s });
let pQueued = false;
function pdraw() { if (!pQueued) { pQueued = true; requestAnimationFrame(pdrawNow); } }
function pdrawNow() {
  pQueued = false;
  const cv = pcv(); if (!cv || $("#posestudio").hidden) return;
  const g = cv.getContext("2d"), dpr = devicePixelRatio || 1, { s, ox, oy } = P.view, { w, h } = P.scene;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
  g.save(); g.translate(ox, oy); g.scale(s, s);
  g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  if (P.ref) { g.globalAlpha = P.refAlpha; g.drawImage(P.ref, 0, 0, w, h); g.globalAlpha = 1; }
  g.strokeStyle = "#ffffff18"; g.lineWidth = 1 / s;                         // thirds guide
  for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.moveTo(w * f, 0); g.lineTo(w * f, h); g.moveTo(0, h * f); g.lineTo(w, h * f); g.stroke(); }
  const unit = Math.min(w, h) / 1024;
  for (const c of P.scene.chars) {
    const pr = project(c, w, h); if (!pr) continue;
    drawSkeleton(g, pr, unit, { alpha: c.hidden ? 0.15 : 1, hands: P.showHands });
    if (c.id === P.sel) {
      const b = bounds(pr);
      g.strokeStyle = "#4c8dff"; g.lineWidth = 1.5 / s; g.setLineDash([6 / s, 4 / s]); g.strokeRect(b.x, b.y, b.w, b.h); g.setLineDash([]);
      // scale handle (bottom-right) and rotate handle (top)
      g.fillStyle = "#4c8dff"; g.fillRect(b.x + b.w - 5 / s, b.y + b.h - 5 / s, 10 / s, 10 / s);
      g.beginPath(); g.arc(b.x + b.w / 2, b.y - 18 / s, 6 / s, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(b.x + b.w / 2, b.y); g.lineTo(b.x + b.w / 2, b.y - 12 / s); g.stroke();
      // joints get a ring so they read as draggable
      g.strokeStyle = "#fff"; g.lineWidth = 1.2 / s;
      for (const p of pr.body) { g.beginPath(); g.arc(p[0], p[1], 7 / s, 0, Math.PI * 2); g.stroke(); }
      g.font = `${12 / s}px sans-serif`; g.fillStyle = "#cfe0ff";
      g.fillText(c.name || c.label, b.x, b.y - 4 / s);
    }
  }
  if (P.joint && P.hoverJoint != null) {
    const c = pcur(), pr = c && project(c, w, h), p = pr && jointPos(pr, P.hoverJoint);
    if (p) { g.fillStyle = "#fff"; g.font = `${12 / s}px sans-serif`; g.fillText(jointLabel(P.hoverJoint), p[0] + 10 / s, p[1] - 10 / s); }
  }
  g.restore();
  $("#psinfo").textContent = `${w}×${h} · ${P.scene.chars.length} character${P.scene.chars.length === 1 ? "" : "s"}${P.shot ? " · shot " + P.shot : ""}`;
}
function jointPos(pr, key) {
  if (typeof key === "number") return pr.body[key];
  const s = key[1] === "L" ? 0 : 1; return pr.hands[s][+key.slice(2)];
}
const jointLabel = key => typeof key === "number" ? JOINT_NAMES[key] : `${key[1] === "L" ? "left" : "right"} hand point ${key.slice(2)}`;

/* ---------------------------------------------------------------- pointer */
function phit(pt) {
  const { w, h } = P.scene, r = 9 / P.view.s;
  const c = pcur();
  if (c) {                                                  // joints and handles of the selected figure first
    const pr = project(c, w, h);
    if (pr) {
      const b = bounds(pr);
      if (Math.hypot(pt.x - (b.x + b.w), pt.y - (b.y + b.h)) < r * 1.3) return { kind: "scale", c, pr, b };
      if (Math.hypot(pt.x - (b.x + b.w / 2), pt.y - (b.y - 18 / P.view.s)) < r * 1.3) return { kind: "rotate", c, pr, b };
      let best = null, bd = r;
      pr.body.forEach((p, i) => { const d = Math.hypot(p[0] - pt.x, p[1] - pt.y); if (d < bd) { bd = d; best = i; } });
      if (P.showHands) pr.hands.forEach((hd, s) => hd.forEach((p, i) => { if (i === 0) return; const d = Math.hypot(p[0] - pt.x, p[1] - pt.y); if (d < bd * 0.8) { bd = d; best = `h${s ? "R" : "L"}${i}`; } }));
      if (best != null) return { kind: "joint", c, pr, key: best };
    }
  }
  for (let i = P.scene.chars.length - 1; i >= 0; i--) {
    const ch = P.scene.chars[i], pr = project(ch, w, h); if (!pr) continue;
    const b = bounds(pr);
    if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return { kind: "move", c: ch, pr, b };
  }
  return null;
}
function psDown(e) {
  if (e.button !== 0) return;
  const r = pcv().getBoundingClientRect(), pt = pToScene(e.clientX - r.left, e.clientY - r.top);
  const hit = phit(pt);
  if (!hit) { P.sel = null; renderPoseSide(); pdraw(); return; }
  if (P.sel !== hit.c.id) { P.sel = hit.c.id; renderPoseSide(); }
  const c = hit.c;
  P.drag = { ...hit, start: pt, orig: deep(c), moved: false };
  pcv().setPointerCapture(e.pointerId);
  pdraw();
}
function psMove(e) {
  const r = pcv().getBoundingClientRect(), pt = pToScene(e.clientX - r.left, e.clientY - r.top);
  const d = P.drag;
  if (!d) {
    const hit = phit(pt);
    pcv().style.cursor = !hit ? "default" : hit.kind === "joint" ? "crosshair" : hit.kind === "scale" ? "nwse-resize" : hit.kind === "rotate" ? "grab" : "move";
    const hj = hit?.kind === "joint" ? hit.key : null;
    if (hj !== P.hoverJoint) { P.hoverJoint = hj; P.joint = hj != null; pdraw(); }
    return;
  }
  const c = d.c, { w, h } = P.scene, dx = pt.x - d.start.x, dy = pt.y - d.start.y;
  d.moved = true;
  if (d.kind === "move") { c.x = d.orig.x + dx / w; c.y = d.orig.y + dy / h; }
  else if (d.kind === "scale") {
    const ax = c.x * w, ay = c.y * h;
    const f = Math.hypot(pt.x - ax, pt.y - ay) / Math.max(1, Math.hypot(d.start.x - ax, d.start.y - ay));
    c.scale = clamp(d.orig.scale * f, 0.05, 4);
  } else if (d.kind === "rotate") {
    const b = d.b, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const a0 = Math.atan2(d.start.y - cy, d.start.x - cx), a1 = Math.atan2(pt.y - cy, pt.x - cx);
    let deg = d.orig.roll + (a1 - a0) * 180 / Math.PI; if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    c.roll = ((deg + 540) % 360) - 180;
  } else if (d.kind === "joint") {
    const k = d.pr.k, e0 = d.orig.edits[d.key] || [0, 0];
    c.edits[d.key] = [e0[0] + dx / k, e0[1] + dy / k];
  }
  pdraw();
}
function psUp() {
  const d = P.drag; P.drag = null; if (!d) return;
  if (d.moved) pcommit({ move: "Moved", scale: "Scaled", rotate: "Rotated", joint: "Joint moved" }[d.kind]);
}
function psWheel(e) {
  const c = pcur(); if (!c) return;
  e.preventDefault();
  if (e.shiftKey) c.yaw = ((c.yaw + (e.deltaY > 0 ? 10 : -10) + 540) % 360) - 180;
  else c.scale = clamp(c.scale * (e.deltaY > 0 ? 0.95 : 1.05), 0.05, 4);
  clearTimeout(P.wheelT); P.wheelT = setTimeout(() => pcommit(e.shiftKey ? "Turned" : "Scaled"), 250);
  pdraw(); renderPoseSide(true);
}

/* ---------------------------------------------------------------- shot presets */
/* Framing = how much of the body fills the frame, measured from the top of the head down
   (fractions of the figure's height). The camera words manga storyboards use. */
const FRAMINGS = [["Full body", 1.0, "Whole figure, feet in frame: establishing, action"], ["Knees up", 0.72, "Cowboy shot: stance and hands"],
  ["Waist up", 0.5, "Medium shot: most dialogue panels"], ["Chest up", 0.33, "Medium close-up: reactions"], ["Close-up", 0.2, "Face fills the panel: emotion"]];
const ANGLES = [["Eye level", 0, 0, "Neutral"], ["Low angle", -18, 0, "Camera below: power, threat"], ["High angle", 22, 0, "Camera above: small, vulnerable"], ["Dutch tilt", 0, 12, "Tilted frame: unease, chaos"]];
const ARRANGE = [["Line-up", "Side by side, facing the reader"], ["Facing", "Two characters face each other (talking, confrontation)"],
  ["Over the shoulder", "First character close, back to the camera; the second faces us"], ["Foreground / back", "One close in front, the other small behind"]];

function figureExtent(c) {               // head top and lowest point at the figure's own scale, in px
  const pr = project(c, P.scene.w, P.scene.h); if (!pr) return null;
  const ys = [...pr.body, ...pr.hands.flat()].map(p => p[1]);
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}
function applyFraming(frac) {
  const { h: H } = P.scene, chars = P.scene.chars.filter(c => !c.hidden);
  if (!chars.length) return toast("Add a character first", "err");
  for (const c of chars) {
    let e = figureExtent(c); if (!e) continue;
    c.scale *= (H * 0.9) / (frac * (e.bottom - e.top));     // visible part spans 90% of the frame
    e = figureExtent(c);
    c.y += (H * 0.06 - e.top) / H;                           // head top just under the frame edge
  }
  pcommit("Framing");
}
function applyAngle(pitch, roll) { for (const c of P.scene.chars) { c.pitch = pitch; c.roll = roll; } pcommit("Camera angle"); }
function applyArrange(kind) {
  const cs = P.scene.chars.filter(c => !c.hidden).sort((a, b) => a.x - b.x);
  if (!cs.length) return toast("Add a character first", "err");
  if (kind === "Line-up") cs.forEach((c, i) => { c.x = (i + 1) / (cs.length + 1); c.yaw = 0; c.flip = false; });
  else if (cs.length < 2) return toast("This needs two characters", "err");
  else if (kind === "Facing") { const [a, b] = cs; a.x = 0.32; b.x = 0.68; a.yaw = 40; b.yaw = -40; b.scale = a.scale; b.y = a.y; }
  else if (kind === "Over the shoulder") {
    const [a, b] = cs; a.x = 0.24; a.yaw = 155; a.scale = b.scale * 1.7; a.y = b.y + 0.35; b.x = 0.66; b.yaw = -20;
    P.scene.chars.splice(P.scene.chars.indexOf(a), 1); P.scene.chars.push(a);        // the near figure draws on top
  } else if (kind === "Foreground / back") { const [a, b] = cs; a.x = 0.3; a.scale = b.scale * 1.35; a.y = b.y + 0.12; b.x = 0.68; b.scale *= 0.75; b.y -= 0.12; }
  pcommit(kind);
}
function presetSection() {
  const btns = (list, fn) => h("div", { class: "btnrow" }, ...list.map(it => h("button", { title: it[it.length - 1], onclick: () => fn(it) }, it[0])));
  return [h("div", { class: "section" }, "Shot presets"),
    h("div", { class: "hint", style: "margin-top:0" }, "Framing"), btns(FRAMINGS, it => applyFraming(it[1])),
    h("div", { class: "hint" }, "Camera"), btns(ANGLES, it => applyAngle(it[1], it[2])),
    h("div", { class: "hint" }, "Staging"), btns(ARRANGE, it => applyArrange(it[0]))];
}

/* ---------------------------------------------------------------- library */
async function loadPoseLib() {
  if (P.lib) return;
  status("Loading poses…");
  try {
    P.lib = (await api("/api/poses")).poses;
    P.byId = new Map(P.lib.map(p => [p.id, p]));
    P.packs = [...new Set(P.lib.map(p => p.pack))];
  } catch (e) { toast("Pose library: " + e.message, "err"); P.lib = []; }
  status("");
}
const thumbObs = new IntersectionObserver(ents => {
  for (const en of ents) if (en.isIntersecting) { paintThumb(en.target); thumbObs.unobserve(en.target); }
}, { root: null, rootMargin: "200px" });
function paintThumb(cv) {
  const pose = P.byId.get(cv.dataset.id); if (!pose) return;
  const g = cv.getContext("2d"), W = cv.width, H = cv.height;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const fake = { pose: pose.id, x: 0.5, y: 0.5, scale: 1, yaw: 0, pitch: 0, roll: 0, flip: false, edits: {} };
  let pr = project(fake, W, H); const b = bounds(pr);       // fit the figure into the tile
  const f = Math.min(W * 0.9 / b.w, H * 0.9 / b.h);
  fake.scale = f; pr = project(fake, W, H); const b2 = bounds(pr);
  fake.x = 0.5 + (W / 2 - (b2.x + b2.w / 2)) / W; fake.y = 0.5 + (H / 2 - (b2.y + b2.h / 2)) / H;
  drawSkeleton(g, project(fake, W, H), 0.5, { hands: false });
}
function renderPoseLib() {
  const box = $("#pslib"); if (!box) return;
  const list = $("#pslist"), q = P.filter.q.toLowerCase();
  const sel = $("#pspack");
  if (sel.options.length !== P.packs.length + 1) {
    sel.innerHTML = ""; sel.append(h("option", { value: "" }, `All packs (${P.lib.length})`));
    for (const k of P.packs) sel.append(h("option", { value: k }, `${k} (${P.lib.filter(p => p.pack === k).length})`));
    sel.value = P.filter.pack;
  }
  list.innerHTML = "";
  const hits = P.lib.filter(p => (!P.filter.pack || p.pack === P.filter.pack) && (!q || (p.name + " " + p.group + " " + p.pack).toLowerCase().includes(q)));
  let lastGroup = null;
  for (const p of hits.slice(0, 600)) {
    const grp = (P.filter.pack ? "" : p.pack + (p.group ? " › " : "")) + p.group;
    if (grp !== lastGroup) { list.append(h("div", { class: "psgroup" }, grp || p.pack)); lastGroup = grp; }
    const cv = h("canvas", { width: 96, height: 128, "data-id": p.id });
    const el = h("div", { class: "pstile", title: `${p.name}\n${p.pack}${p.group ? " › " + p.group : ""}\nClick: use for the selected character (or add one). Drag onto the canvas to add.`,
      draggable: true, onclick: () => usePose(p.id) }, cv, h("div", { class: "cap" }, p.name));
    el.addEventListener("dragstart", e => e.dataTransfer.setData("application/x-pose", p.id));
    list.append(el); thumbObs.observe(cv);
  }
  if (hits.length > 600) list.append(h("div", { class: "hint" }, `${hits.length - 600} more: narrow the search.`));
  if (!hits.length) list.append(h("div", { class: "hint" }, "No poses match."));
}
function usePose(id, at) {
  let c = pcur();
  if (!c || at) {
    c = newChar(id, at ? at.x / P.scene.w : 0.5, at ? Math.min(0.98, at.y / P.scene.h + 0.4) : 0.92);
    if (!at && P.scene.chars.length) c.x = clamp(0.25 + 0.5 * (P.scene.chars.length % 3) / 2, 0.1, 0.9);
    P.scene.chars.push(c); P.sel = c.id; pcommit("Character added");
  } else { c.pose = id; c.edits = {}; pcommit("Pose: " + (P.byId.get(id)?.name || id)); }
}

/* ---------------------------------------------------------------- side panel */
function prow(label, ...kids) { return h("div", { class: "row" }, h("label", {}, label), ...kids); }
function pslider(label, c, key, min, max, step, fmt = v => v) {
  const out = h("span", { class: "val" }, fmt(c[key]));
  const inp = h("input", { type: "range", min, max, step, value: c[key], style: "flex:1",
    oninput: e => { c[key] = +e.target.value; out.textContent = fmt(c[key]); pdraw(); }, onchange: () => pcommit() });
  inp.addEventListener("dblclick", () => { c[key] = key === "scale" ? 0.85 : 0; pcommit(); });
  return prow(label, inp, out);
}
function renderPoseSide(valuesOnly) {
  const side = $("#psside"); if (!side || (valuesOnly && P.drag)) return;
  side.innerHTML = "";
  const S2 = P.scene;
  // scene
  const asp = h("select", { onchange: e => { const [w, hh] = e.target.value.split("x").map(Number); S2.w = w; S2.h = hh; pcommit("Canvas " + e.target.value); pfit(); } },
    ...(ASPECTS.some(a => a[0] === `${S2.w}x${S2.h}`) ? [] : [h("option", { value: `${S2.w}x${S2.h}` }, `Panel (${S2.w}×${S2.h})`)]),
    ...ASPECTS.map(([v, t]) => h("option", { value: v }, t)));
  asp.value = `${S2.w}x${S2.h}`;
  side.append(h("div", { class: "section" }, "Scene"), prow("Canvas", asp),
    prow("Shot", h("input", { value: P.shot, placeholder: "ch1_s01", style: "flex:1", onchange: e => { P.shot = e.target.value.trim(); pdraw(); } })),
    h("div", { class: "row col" }, h("label", {}, "Prompt (scene, action, expression)"),
      h("textarea", { rows: 3, value: S2.prompt || "", placeholder: "classroom, after school, both smiling, looking at each other", onchange: e => { S2.prompt = e.target.value; pcommit(); } })),
    h("div", { class: "row" }, h("label", { class: "chk" }, h("input", { type: "checkbox", checked: P.showHands, onchange: e => { P.showHands = e.target.checked; pdraw(); } }), " Hands"),
      h("label", { class: "chk" }, "Guide ", h("input", { type: "file", accept: "image/*", style: "width:120px", onchange: e => loadRef(e.target.files[0]) })),
      P.ref ? h("input", { type: "range", min: 0, max: 1, step: 0.05, value: P.refAlpha, title: "Guide opacity (never exported)", oninput: e => { P.refAlpha = +e.target.value; pdraw(); } }) : null));
  side.append(...presetSection());
  // characters
  side.append(h("div", { class: "section" }, "Characters ", h("span", { class: "hint" }, "left to right in the frame = order in the prompt")));
  const list = h("div", { class: "pschars" });
  const ordered = [...S2.chars].sort((a, b) => a.x - b.x);
  for (const c of ordered) {
    list.append(h("div", { class: "pschar" + (c.id === P.sel ? " on" : ""), onclick: () => { P.sel = c.id; renderPoseSide(); pdraw(); } },
      h("span", { class: "dot" }, c.hidden ? "◌" : "●"), h("b", {}, c.name || c.label),
      h("span", { class: "hint" }, P.byId.get(c.pose)?.name || "?"),
      h("span", { class: "spacer" }),
      h("button", { class: "ghost", title: "Hide / show", onclick: e => { e.stopPropagation(); c.hidden = !c.hidden; pcommit(); } }, c.hidden ? "👁‍🗨" : "👁"),
      h("button", { class: "ghost", title: "Duplicate", onclick: e => { e.stopPropagation(); const d = { ...deep(c), id: uid(), x: Math.min(0.95, c.x + 0.12) }; S2.chars.push(d); P.sel = d.id; pcommit("Duplicated"); } }, "⧉"),
      h("button", { class: "ghost", title: "Delete", onclick: e => { e.stopPropagation(); S2.chars = S2.chars.filter(q => q !== c); if (P.sel === c.id) P.sel = null; pcommit("Character removed"); } }, "🗑")));
  }
  if (!S2.chars.length) list.append(h("div", { class: "hint" }, "Click a pose in the library (or drag it onto the canvas) to add a character."));
  side.append(list, h("div", { class: "btnrow" }, h("button", { onclick: () => { P.sel = null; usePose(P.byId.has("basic/Standing") ? "basic/Standing" : P.lib[0].id); } }, "＋ Character")));
  // selected character
  const c = pcur();
  if (c) {
    side.append(h("div", { class: "section" }, c.name || c.label),
      prow("Name", h("input", { value: c.name, placeholder: "Rem", style: "flex:1", list: "castnames", onchange: e => {
        c.name = e.target.value.trim();
        const k = typeof castFor === "function" && castFor(c.name);      // known from the character sheet
        if (k) { c.series ||= k.series || ""; c.tags ||= k.tags || ""; c.gender = k.gender || c.gender; if (k.pose && P.byId.has(k.pose) && c.pose === "basic/Standing") c.pose = k.pose; }
        pcommit();
      } })),
      h("datalist", { id: "castnames" }, ...((typeof CAST !== "undefined" && CAST.list) || []).map(k => h("option", { value: k.name }))),
      prow("Series", h("input", { value: c.series, placeholder: "Re:Zero", style: "flex:1", onchange: e => { c.series = e.target.value.trim(); pcommit(); } })),
      prow("Who", (() => { const s = h("select", { onchange: e => { c.gender = e.target.value; pcommit(); } }, h("option", { value: "girl" }, "Girl"), h("option", { value: "boy" }, "Boy")); s.value = c.gender || "girl"; return s; })()),
      prow("Looks", h("input", { value: c.tags || "", placeholder: "silver hair, school uniform", style: "flex:1", title: "Appearance tags (used for unnamed characters and when no LoRA is found)", onchange: e => { c.tags = e.target.value.trim(); pcommit(); } })),
      h("p", { class: "hint" }, "Leave the name empty for an original character: it is described by Who + Looks, with no LoRA lookup."),
      prow("Pose", h("span", { class: "hint", style: "flex:1" }, P.byId.get(c.pose)?.name || c.pose)),
      pslider("Turn", c, "yaw", -180, 180, 1, v => `${Math.round(v)}°`),
      pslider("Tilt", c, "pitch", -90, 90, 1, v => `${Math.round(v)}°`),
      pslider("Rotate", c, "roll", -180, 180, 1, v => `${Math.round(v)}°`),
      pslider("Size", c, "scale", 0.05, 3, 0.01, v => (+v).toFixed(2) + "×"),
      h("div", { class: "btnrow" },
        h("button", { onclick: () => { c.flip = !c.flip; pcommit("Mirrored"); } }, "Mirror ⇆"),
        h("button", { onclick: () => { c.yaw = ((c.yaw + 180 + 540) % 360) - 180; pcommit("Turned around"); } }, "Face away"),
        h("button", { disabled: !Object.keys(c.edits).length, onclick: () => { c.edits = {}; pcommit("Joint edits cleared"); } }, "Reset joints")),
      h("div", { class: "btnrow" },
        h("button", { onclick: () => { const i = S2.chars.indexOf(c); S2.chars.splice(i, 1); S2.chars.push(c); pcommit("To front"); } }, "To front"),
        h("button", { onclick: () => { const i = S2.chars.indexOf(c); S2.chars.splice(i, 1); S2.chars.unshift(c); pcommit("To back"); } }, "To back"),
        h("button", { onclick: saveAsMyPose, title: "Keep this figure (with your joint edits) in the library under My poses" }, "Save to My poses")),
      h("p", { class: "hint" }, "Drag a joint to fine-tune it (wrist drags the hand along). Drag the body to move, the corner square to scale, the dot on top to rotate. " +
        "Scroll = size, Shift+scroll = turn. Arrows nudge, M mirrors, Del deletes."));
  }
  // output
  side.append(h("div", { class: "section" }, "Output"),
    h("div", { class: "btnrow" },
      h("button", { onclick: downloadPose }, "Download PNG"),
      h("button", { onclick: () => savePoseShot(false) }, "Save to shot"),
      h("button", { class: "primary", onclick: () => savePoseShot(true), title: "Save, then render on the pod" }, "Save & render")),
    P.panel ? h("p", { class: "hint" }, "The render lands in the panel you opened this from.") : null);
}
async function loadRef(f) {
  if (!f) return;
  const im = new Image(); im.onload = () => { P.ref = im; P.refAlpha = 0.35; renderPoseSide(); pdraw(); }; im.src = URL.createObjectURL(f);
}

/* bake the selected figure's current 2D look back into 3D-ish points: joint edits move x/y, depth stays */
async function saveAsMyPose() {
  const c = pcur(); if (!c) return;
  const name = prompt("Name for this pose", (P.byId.get(c.pose)?.name || "Pose") + " (edited)"); if (!name) return;
  const fake = { ...deep(c), x: 0.5, y: 0.5, scale: 1, roll: 0 };
  const W = 1000, H = 1000, pr = project(fake, W, H), k = pr.k;
  const hipY = (pr.body[8][1] + pr.body[11][1]) / 2, hipX = (pr.body[8][0] + pr.body[11][0]) / 2;
  const to3 = p => [+((p[0] - hipX) / k).toFixed(4), +(-(p[1] - hipY) / k).toFixed(4), +(p[2] || 0).toFixed(4)];
  let body = pr.body.map(to3), hands = pr.hands.map(hd => hd.map(to3));
  const minY = Math.min(...body.map(p => p[1]), ...hands.flat().map(p => p[1]));
  const lift = p => [p[0], +(p[1] - minY).toFixed(4), p[2]];
  body = body.map(lift); hands = hands.map(hd => hd.map(lift));
  try {
    const e = await post("/api/poses/custom", { name, body, hands });
    P.lib.unshift(e); P.byId.set(e.id, e); if (!P.packs.includes("My poses")) P.packs.unshift("My poses");
    c.pose = e.id; c.edits = {}; c.yaw = 0; c.pitch = 0; c.flip = false; pcommit("Saved to My poses"); renderPoseLib();
  } catch (e) { toast(e.message, "err"); }
}
function downloadPose() {
  const a = h("a", { href: renderPosePNG().toDataURL("image/png"), download: `${P.shot || "pose"}_openpose.png` }); a.click();
}
async function savePoseShot(andRender) {
  const vis = P.scene.chars.filter(c => !c.hidden);
  if (!vis.length) return toast("Add a character first", "err");
  let name = P.shot;
  if (!name) { name = prompt("Shot folder name (shots/<name>)", "pose_" + new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "")); if (!name) return; P.shot = name.trim(); }
  let chars = [...vis].sort((a, b) => a.x - b.x).map(c => ({ name: c.name || "", series: c.series || "", gender: c.gender || "girl", tags: c.tags || "" }));
  if (typeof enrichChars === "function") chars = enrichChars(chars);
  try {
    await post("/api/pose/shot", { name: P.shot, png: renderPosePNG().toDataURL("image/png"), scene: { ...P.scene, shot: P.shot }, characters: chars, prompt: P.scene.prompt || "" });
    P.dirty = false; toast(`Saved pose to shots/${P.shot}`, "ok");
    await loadShots();
    if (P.panel) {                                         // tie the panel to the shot so the render lands there
      for (const pg of S.doc.pages) for (const l of pg.layers) if (l.id === P.panel) { l.shot = P.shot; commit("Panel shot: " + P.shot); }
      refreshPanels();
    }
    if (andRender) renderShot(P.shot);
    renderPoseSide();
  } catch (e) { toast(e.message, "err"); }
}

/* ---------------------------------------------------------------- open / close */
async function openPoseStudio(opt = {}) {
  await loadPoseLib();
  if (opt.shot !== undefined || !P.scene) {
    P.shot = opt.shot || ""; P.panel = opt.panel || null; P.scene = null;
    if (P.shot) { try { const sc = await api(`/api/pose/scene?name=${encodeURIComponent(P.shot)}`); P.scene = { ...newScene(), ...sc }; } catch { } }
    if (!P.scene) {
      let w = 832, hh = 1216;
      if (opt.aspect) { const long = 1216, a = opt.aspect; [w, hh] = a >= 1 ? [long, Math.round(long / a / 8) * 8] : [Math.round(long * a / 8) * 8, long]; }
      P.scene = newScene(w, hh); P.scene.prompt = opt.prompt || "";
      if (opt.chars?.length) opt.chars.forEach((n, i) => { const c = newChar(P.byId.has("basic/Standing") ? "basic/Standing" : P.lib[0]?.id, (i + 1) / (opt.chars.length + 1)); c.name = n.name || ""; c.series = n.series || ""; P.scene.chars.push(c); });
    }
    P.sel = null; P.undo = []; P.redo = []; P.snap = JSON.stringify(P.scene); P.dirty = false;
  }
  setMode("pose");
}
function setMode(m) {
  S.mode = m;
  $$("#modetabs button").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
  $("#posestudio").hidden = m !== "pose";
  $("#workspace").hidden = m === "pose"; $("#optionsbar").hidden = m === "pose";
  if (m === "pose") {
    if (!P.scene) return openPoseStudio();
    renderPoseLib(); renderPoseSide(); requestAnimationFrame(pfit);
  } else { resize(); requestDraw(); }
}
/* panel -> pose studio, sized to the panel, with the shot's characters when it has a sidecar */
function poseForPanel(l) {
  const s = S.shots.find(q => q.name === l.shot);
  let chars = [];
  if (s?.yaml) { const m = [...s.yaml.matchAll(/-\s*name:\s*"?([^"\n]+)"?\s*\n\s*series:\s*"?([^"\n]*)"?/g)]; chars = m.map(x => ({ name: x[1].trim(), series: x[2].trim() })); }
  let prompt = "";
  const pm = s?.yaml?.match(/^prompt:\s*(.*)$/m);
  if (pm) { try { prompt = pm[1].trim().startsWith('"') ? JSON.parse(pm[1].trim()) : pm[1].trim(); } catch { prompt = pm[1].replace(/^"|"$/g, ""); } }
  openPoseStudio({ shot: l.shot || "", panel: l.id, aspect: l.w / l.h, chars, prompt });
}

function poseKey(e) {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  const mod = e.metaKey || e.ctrlKey, c = pcur();
  if (mod && e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); setMode("page"); return; }
  if (e.key === "`") { toggleJobs(); return; }
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? predo() : pundo(); return; }
  if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); predo(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); savePoseShot(false); return; }
  if (mod && e.key.toLowerCase() === "d" && c) { e.preventDefault(); const d = { ...deep(c), id: uid(), x: Math.min(0.95, c.x + 0.12) }; P.scene.chars.push(d); P.sel = d.id; pcommit("Duplicated"); return; }
  if (!c) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); P.scene.chars = P.scene.chars.filter(q => q !== c); P.sel = null; pcommit("Character removed"); return; }
  if (e.key === "Escape") { P.sel = null; renderPoseSide(); pdraw(); return; }
  if (e.key.toLowerCase() === "m" && !mod) { c.flip = !c.flip; pcommit("Mirrored"); return; }
  if (e.key.startsWith("Arrow")) {
    e.preventDefault(); const n = (e.shiftKey ? 10 : 1);
    c.x += (e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0) / P.scene.w; c.y += (e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0) / P.scene.h;
    clearTimeout(P.nudgeT); P.nudgeT = setTimeout(() => pcommit("Nudged"), 300); pdraw();
  }
}

/* ---------------------------------------------------------------- wiring */
(function initPoseStudio() {
  $$("#modetabs button").forEach(b => b.onclick = () => setMode(b.dataset.mode));
  const cv = pcv();
  cv.addEventListener("pointerdown", psDown); cv.addEventListener("pointermove", psMove);
  cv.addEventListener("pointerup", psUp); cv.addEventListener("pointercancel", psUp);
  cv.addEventListener("wheel", psWheel, { passive: false });
  const st = $("#psstage");
  st.addEventListener("dragover", e => { if (e.dataTransfer.types.includes("application/x-pose")) e.preventDefault(); });
  st.addEventListener("drop", e => {
    const id = e.dataTransfer.getData("application/x-pose"); if (!id) return; e.preventDefault();
    const r = cv.getBoundingClientRect(); usePose(id, pToScene(e.clientX - r.left, e.clientY - r.top));
  });
  new ResizeObserver(() => { if (S.mode === "pose") pfit(); }).observe(st);
  let qT = null;
  $("#psq").addEventListener("input", e => { clearTimeout(qT); qT = setTimeout(() => { P.filter.q = e.target.value; renderPoseLib(); }, 150); });
  $("#pspack").addEventListener("change", e => { P.filter.pack = e.target.value; renderPoseLib(); });
  $("#psclear").onclick = () => { if (P.scene.chars.length && !confirm("Remove every character from this scene?")) return; P.scene.chars = []; P.sel = null; pcommit("Cleared"); };
  $("#psnew").onclick = () => { if (P.dirty && !confirm("Start a new pose scene? Unsaved changes are lost.")) return; openPoseStudio({ shot: "" }); };
  $("#psopen").onclick = async () => {
    await loadShots();
    const box = modal("Open a shot's pose", "small"), body = $(".mbody", box);
    const withScene = S.shots.filter(s => s.scene);
    if (!withScene.length) body.append(h("p", { class: "hint" }, "No shot has a pose scene yet. Shots posed here are saved with one."));
    for (const s of withScene) body.append(h("div", { class: "row" }, h("button", { style: "flex:1;text-align:left", onclick: () => { closeModal(); openPoseStudio({ shot: s.name }); } }, s.name)));
  };
  $("#psback").onclick = () => setMode("page");
})();
