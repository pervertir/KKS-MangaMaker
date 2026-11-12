import { $, clamp, deep, h, post, uid } from "../editor/core.js";
import { commit } from "../editor/history.js";
import { thumb } from "../editor/images.js";
import { renderShot } from "../editor/jobs.js";
import { refreshPanels, status, toast } from "../editor/misc.js";
import { loadShots } from "../editor/shots.js";
import { S } from "../editor/state.ts";
import { CAST, castFor, enrichChars } from "../helpers/cast.js";
import { renderPosePNG } from "./draw.js";
import { project } from "./geometry.js";
import { renderPoseLib, usePose } from "./library.js";
import { ASPECTS, JOINT_NAMES, P, partName, setPart } from "./model.js";
import { presetSection } from "./presets.js";
import { newChar, pcommit, pcur } from "./scene.js";
import { pdraw, pfit } from "./view.js";

/* ---------------------------------------------------------------- side panel */
export function prow(label, ...kids) { return h("div", { class: "row" }, h("label", {}, label), ...kids); }
export function pslider(label, c, key, min, max, step, fmt = v => v) {
  const out = h("span", { class: "val" }, fmt(c[key]));
  const inp = h("input", { type: "range", min, max, step, value: c[key], style: "flex:1",
    oninput: e => { c[key] = +e.target.value; out.textContent = fmt(c[key]); pdraw(); }, onchange: () => pcommit() });
  inp.addEventListener("dblclick", () => { c[key] = key === "scale" ? 0.85 : 0; pcommit(); });
  return prow(label, inp, out);
}
export function renderPoseSide(valuesOnly) {
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
    h("div", { class: "row" }, h("label", { class: "chk", title: "Drag a hand or foot and the whole arm or leg follows; Alt-drag moves one joint" },
        h("input", { type: "checkbox", checked: P.ik, onchange: e => { P.ik = e.target.checked; } }), " IK limbs"),
      h("label", { class: "chk" }, h("input", { type: "checkbox", checked: P.showHands, onchange: e => { P.showHands = e.target.checked; pdraw(); } }), " Hands"),
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
  side.append(list, h("div", { class: "btnrow" }, h("button", { onclick: () => { P.sel = null; usePose(P.byId.has("basic/Standing") ? "basic/Standing" : P.lib[0].id); } }, "＋ Character"),
    h("button", { disabled: !S2.chars.length, onclick: saveGroupPose, title: "Save every figure in this scene, posed and placed, as one group pose under My poses" }, "Save group pose")));
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
        h("button", { onclick: saveAsMyPose, title: "Keep this figure (with your joint edits) in the library under My poses" }, "Save pose")),
      ...partSection(c),
      h("p", { class: "hint" }, "Drag a hand or foot and the limb follows (IK); drag an elbow or knee to swing it; drag the nose to turn the head. Alt-drag moves one joint. " +
        "Drag the body to move, a square handle to scale, the knob on top to rotate (Shift snaps 15°). " +
        "Scroll = size, Shift+scroll = turn. Arrows nudge, M mirrors, H hides the joint under the pointer, Del deletes."));
  }
  // output
  side.append(h("div", { class: "section" }, "Output"),
    h("div", { class: "btnrow" },
      h("button", { onclick: downloadPose }, "Download PNG"),
      h("button", { onclick: () => savePoseShot(false) }, "Save to shot"),
      h("button", { class: "primary", onclick: () => savePoseShot(true), title: "Save, then render on the pod" }, "Save & render")),
    P.panel ? h("p", { class: "hint" }, "The render lands in the panel you opened this from.") : null);
}
/* Joints of the selected figure that are not drawn (out of the picture it was read from, or cut by hand):
   add one back, where it then sits at a guessed spot to be dragged into place, or cut one that is drawn. */
export function partSection(c) {
  const pr = project(c, P.scene.w, P.scene.h); if (!pr) return [];
  const handGone = s => pr.hands[s].length > 0 && pr.hoff[s].every(Boolean);
  const gone = [...[...pr.miss].sort((a, b) => a - b), ...[0, 1].filter(handGone).map(s => s ? "hR" : "hL")];
  const here = [...JOINT_NAMES.keys()].filter(i => !pr.miss.has(i)).concat([0, 1].filter(s => pr.hands[s].length && !handGone(s)).map(s => s ? "hR" : "hL"));
  const sel = h("select", { style: "flex:1" }, ...here.map(k => h("option", { value: String(k) }, partName(k))));
  const cut = () => { const v = sel.value; if (v === "") return; const k = /^\d+$/.test(v) ? +v : v; setPart(c, k, false); pcommit(`Hidden: ${partName(k)}`); };
  return [
    prow("Joints", sel, h("button", { disabled: !here.length, title: "Do not draw this joint, nor the limb beyond it (a figure cut by the frame). Or hover a joint and press H", onclick: cut }, "Hide")),
    gone.length ? h("div", { class: "hint", style: "margin-top:0" }, `Not drawn (${gone.length}): outside the picture, or hidden. Add one back, then drag it into place.`) : null,
    gone.length ? h("div", { class: "btnrow" },
      ...gone.map(k => h("button", { title: "Draw this joint again", onclick: () => { setPart(c, k, true); pcommit(`Added: ${partName(k)}`); } }, "＋ " + partName(k))),
      gone.length > 1 ? h("button", { onclick: () => { gone.forEach(k => setPart(c, k, true)); pcommit("All joints shown"); } }, "Add all") : null) : null];
}
/* Pose from an image: the picture goes to the pod's pose detector; every person found comes back as a
   figure where they stand (saved under My poses), and the picture stays underneath as a guide. */
export async function poseFromImage(f) {
  if (!f) return;
  status("Finding the people in the picture on the pod…"); toast("Detecting poses on the pod (a few seconds once it is warm)…");
  try {
    const r = await post(`/api/pose/detect?name=${encodeURIComponent(f.name)}`, f, true);
    if (!r.people.length) { status(""); return toast("No people found in that picture", "err"); }
    const ia = r.w / r.h;
    if (!P.panel && !P.scene.chars.length) {
      const best = ASPECTS.map(([v]) => v.split("x").map(Number)).sort((p, q) => Math.abs(p[0] / p[1] - ia) - Math.abs(q[0] / q[1] - ia))[0];
      [P.scene.w, P.scene.h] = best;
    }
    const sa = P.scene.w / P.scene.h;
    for (const { pose, place } of r.people) {
      P.lib.unshift(pose); P.byId.set(pose.id, pose);
      const c = newChar(pose.id, 0.5 + (place.x - 0.5) * ia / sa, place.y);
      c.scale = place.scale; P.scene.chars.push(c); P.sel = c.id;
    }
    const im = new Image(); im.onload = () => { P.ref = im; P.refAlpha = 0.45; pdraw(); renderPoseSide(); }; im.src = thumb(r.guide, 1600);
    pcommit(`${r.people.length} figure${r.people.length > 1 ? "s" : ""} from ${f.name}`); pfit(); renderPoseLib(); status("");
  } catch (e) { status(""); toast(e.message, "err"); }
}
export async function loadRef(f) {
  if (!f) return;
  const im = new Image(); im.onload = () => { P.ref = im; P.refAlpha = 0.35; renderPoseSide(); pdraw(); }; im.src = URL.createObjectURL(f);
}

/* bake the selected figure's current 2D look back into 3D-ish points: joint edits move x/y, depth stays */
/* bake a figure as it looks now (turn, tilt, rotation, mirror and joint edits) into library points
   (metres, floor at y = 0, hips centred), plus where it stands on the canvas */
export function bakeChar(c) {
  const { w: W, h: H } = P.scene, pr = project(c, W, H), k = pr.k;
  const hipX = (pr.body[8][0] + pr.body[11][0]) / 2;
  const floorY = Math.max(...pr.body.map(p => p[1]), ...pr.hands.flat().map(p => p[1]));
  // joints the figure does not have stay marked ([x, y, z, 0]) in the baked pose
  const to3 = (p, off) => [+((p[0] - hipX) / k).toFixed(4), +((floorY - p[1]) / k).toFixed(4), +(p[2] || 0).toFixed(4), ...(off ? [0] : [])];
  return { body: pr.body.map((p, i) => to3(p, pr.miss.has(i))), hands: pr.hands.map((hd, s) => hd.map((p, i) => to3(p, pr.hoff[s][i]))), x: +(hipX / W).toFixed(4), y: +(floorY / H).toFixed(4), scale: +c.scale.toFixed(4) };
}
export async function saveAsMyPose() {
  const c = pcur(); if (!c) return toast("Select a character first", "err");
  const name = prompt("Name for this pose", (P.byId.get(c.pose)?.name || "Pose") + " (edited)"); if (!name) return;
  const b = bakeChar(c);
  try {
    const e = await post("/api/poses/custom", { name, body: b.body, hands: b.hands });
    P.lib.unshift(e); P.byId.set(e.id, e);
    Object.assign(c, { pose: e.id, edits: {}, show: [], cut: [], yaw: 0, pitch: 0, roll: 0, flip: false, x: b.x, y: b.y });
    pcommit("Saved to My poses"); renderPoseLib();
  } catch (e) { toast(e.message, "err"); }
}
/* the whole scene as one reusable group pose: every visible figure, its pose and its place */
export async function saveGroupPose() {
  const cs = P.scene.chars.filter(c => !c.hidden);
  if (!cs.length) return toast("Add characters first", "err");
  const name = prompt(`Name for this group pose (${cs.length} figure${cs.length > 1 ? "s" : ""})`, P.shot || "Group pose"); if (!name) return;
  const members = cs.map(c => { const b = bakeChar(c); return { body: b.body, hands: b.hands, x: b.x, y: b.y, scale: b.scale, label: c.name || c.label, gender: c.gender || "girl" }; });
  try {
    const e = await post("/api/poses/custom", { name, members, aspect: P.scene.w / P.scene.h });
    registerGroup(e); P.lib.unshift(e); if (!P.packs.includes(e.kind)) P.packs.unshift(e.kind);
    P.filter.pack = "@mine"; $("#pspack").dataset.sig = ""; renderPoseLib();
    toast(`Saved "${name}" with ${members.length} figure${members.length > 1 ? "s" : ""} under My poses`, "ok");
  } catch (e) { toast(e.message, "err"); }
}
export function registerGroup(g) {
  (g.members || []).forEach((m, i) => P.byId.set(`${g.id}#${i}`, { id: `${g.id}#${i}`, name: `${g.name} ${i + 1}`, kind: g.kind, body: m.body, hands: m.hands }));
  P.byId.set(g.id, g);
}
/* drop a group pose in: replace the scene's figures (keeping their names in order) or add beside them */
export function useGroup(g) {
  const cs = P.scene.chars;
  const replace = !cs.length || confirm(`Use "${g.name}" for the scene? OK replaces the current figures (names carry over, left to right); Cancel adds the group beside them.`);
  const names = replace ? [...cs].sort((a, b) => a.x - b.x) : [];
  const ga = g.aspect || 0.7;
  if (replace && !P.panel) {                       // a free scene takes the group's shape
    const best = ASPECTS.map(([v]) => v.split("x").map(Number)).sort((p, q) => Math.abs(p[0] / p[1] - ga) - Math.abs(q[0] / q[1] - ga))[0];
    [P.scene.w, P.scene.h] = best; requestAnimationFrame(pfit);
  }
  const sa = P.scene.w / P.scene.h;
  // member places are fractions of the group's own canvas; keep the real spacing on this one
  const fitS = Math.min(1, sa / ga * 1.0);
  const fresh = g.members.map((m, i) => {
    const c = newChar(`${g.id}#${i}`, 0.5 + (m.x - 0.5) * ga / sa * fitS, m.y);
    m = { ...m, scale: m.scale * fitS };
    Object.assign(c, { scale: m.scale, z: m.z || 0, gender: m.gender || "girl", label: m.label || c.label });
    const old = names[i]; if (old) Object.assign(c, { name: old.name, series: old.series, tags: old.tags, gender: old.gender || c.gender, label: old.label });
    if (!replace) c.x = clamp(c.x * 0.5 + 0.5, 0.05, 0.95);
    return c;
  });
  P.scene.chars = replace ? fresh : [...cs, ...fresh];
  P.sel = fresh[0]?.id || null; pcommit(`Group pose: ${g.name}`);
}
export function downloadPose() {
  const a = h("a", { href: renderPosePNG().toDataURL("image/png"), download: `${P.shot || "pose"}_openpose.png` }); a.click();
}
export async function savePoseShot(andRender) {
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
