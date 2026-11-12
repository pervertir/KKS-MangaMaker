import { $, $$, api, deep, uid } from "../editor/core.js";
import { toggleJobs } from "../editor/jobs.js";
import { status, toast } from "../editor/misc.js";
import { S } from "../editor/state.ts";
import { inField } from "../editor/tools.js";
import { requestDraw, resize } from "../editor/view.js";
import { loadPoseLib, renderPoseLib } from "./library.js";
import { P, partName, setPart } from "./model.js";
import { newChar, newScene, pcommit, pcur, predo, pundo } from "./scene.js";
import { renderPoseSide, savePoseShot } from "./side.js";
import { pdraw, pfit } from "./view.js";

/* ---------------------------------------------------------------- open / close */
export async function openPoseStudio(opt = {}) {
  await loadPoseLib();
  if (opt.shot !== undefined || !P.scene) {
    P.shot = opt.shot || ""; P.panel = opt.panel || null; P.scene = null; P.liveKey = null;
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
export function setMode(m) {
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
export function poseForPanel(l) {
  const s = S.shots.find(q => q.name === l.shot);
  let chars = [];
  if (s?.yaml) { const m = [...s.yaml.matchAll(/-\s*name:\s*"?([^"\n]+)"?\s*\n\s*series:\s*"?([^"\n]*)"?/g)]; chars = m.map(x => ({ name: x[1].trim(), series: x[2].trim() })); }
  let prompt = "";
  const pm = s?.yaml?.match(/^prompt:\s*(.*)$/m);
  if (pm) { try { prompt = pm[1].trim().startsWith('"') ? JSON.parse(pm[1].trim()) : pm[1].trim(); } catch { prompt = pm[1].replace(/^"|"$/g, ""); } }
  openPoseStudio({ shot: l.shot || "", panel: l.id, aspect: l.w / l.h, chars, prompt });
}

export function poseKey(e) {
  if (inField(e)) return;
  if (["INPUT", "SELECT"].includes(e.target.tagName) && ["Delete", "Backspace"].includes(e.key)) e.target.blur();
  const mod = e.metaKey || e.ctrlKey, c = pcur();
  if (mod && e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); setMode("page"); return; }
  if (e.key === "`") { toggleJobs(); return; }
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? predo() : pundo(); return; }
  if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); predo(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); savePoseShot(false); return; }
  if (mod && e.key.toLowerCase() === "d" && c) { e.preventDefault(); const d = { ...deep(c), id: uid(), x: Math.min(0.95, c.x + 0.12) }; P.scene.chars.push(d); P.sel = d.id; pcommit("Duplicated"); return; }
  if (!c) { if (e.key === "Delete" || e.key === "Backspace") status("Click a character to select it, then Delete removes it"); return; }
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); P.scene.chars = P.scene.chars.filter(q => q !== c); P.sel = null; pcommit("Character removed"); toast(`Removed ${c.name || c.label} — ⌘Z brings it back`); return; }
  if (e.key === "Escape") { P.sel = null; renderPoseSide(); pdraw(); return; }
  if (e.key.toLowerCase() === "m" && !mod) { c.flip = !c.flip; pcommit("Mirrored"); return; }
  if (e.key.toLowerCase() === "h" && !mod && P.hoverJoint != null) {      // hide the joint under the pointer (a hand point: the hand)
    const k = typeof P.hoverJoint === "number" ? P.hoverJoint : P.hoverJoint.slice(0, 2);
    setPart(c, k, false); P.hoverJoint = null; P.joint = false; pcommit(`Hidden: ${partName(k)}`); return;
  }
  if (e.key.startsWith("Arrow")) {
    e.preventDefault(); const n = (e.shiftKey ? 10 : 1);
    c.x += (e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0) / P.scene.w; c.y += (e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0) / P.scene.h;
    clearTimeout(P.nudgeT); P.nudgeT = setTimeout(() => pcommit("Nudged"), 300); pdraw();
  }
}
