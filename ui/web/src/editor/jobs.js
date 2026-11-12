import { $, api, h, post } from "./core.js";
import { commit } from "./history.js";
import { imgSize } from "./library.js";
import { popMenu } from "./menus.js";
import { toast } from "./misc.js";
import { renderPageThumbs } from "./pages.js";
import { renderPanelsTab } from "./panels-tab.js";
import { loadShots } from "./shots.js";
import { S } from "./state.ts";
import { requestDraw } from "./view.js";
import { ui } from "../ui/store.svelte.ts";
import { IMG } from "./images.js";
import { matteRef } from "./drawing.js";
import { refreshProps } from "./props.js";

/* ================================================================ jobs & pod */
export async function startJob(body) {
  try {
    const r = await post("/api/jobs", body);
    S.jobs[r.id] = { id: r.id, label: body.cmd === "pod" ? "pod " + body.action : `${body.cmd} ${body.shot}`, lines: [], next: 0, done: false, body };
    S.jobView = r.id; toggleJobs(true); pollJobs(); renderPanelsTab();
    return r.id;
  } catch (e) { toast(e.message, "err"); }
}
export function renderShot(name, seed) {
  if (S.pod && !S.pod.running) toast("The pod isn't running: Pipeline › Start pod first", "err");
  startJob({ cmd: "run", shot: name, seed: seed || undefined });
}
export function podAction(a) {
  if (a === "stop" && !confirm("Stop the RunPod pod? GPU billing stops; models stay on the volume.")) return;
  startJob({ cmd: "pod", action: a });
}
export let pollT = null;
export async function pollJobs() {
  clearTimeout(pollT);
  let active = false, ended = false;
  for (const j of Object.values(S.jobs)) {
    if (j.done) continue;
    active = true;
    try {
      const r = await api(`/api/jobs/${j.id}?since=${j.next}`);
      j.lines.push(...r.lines); j.next = r.next;
      if (r.done) {
        j.done = true; j.code = r.code;
        toast(`${j.label}: ${r.code === 0 ? "done" : "failed"}`, r.code === 0 ? "ok" : "err");
        if (["run", "render", "grab"].includes(j.body.cmd)) await afterRender(j.body.shot, j.body.cmd !== "grab");
        if (j.body.cmd === "pod") refreshPod(true);
        if (j.body.cmd === "matte" && r.code === 0) mattesReady(j.body.image);
      }
    } catch (e) { j.done = true; j.lines.push("error: " + e.message); }
    ended ||= j.done;
  }
  renderJobs();
  if (ended && S.doc) renderPanelsTab();      // a panel's status follows its shot's job
  $("#jobsbtn").classList.toggle("busy", active);
  $("#jobsbtn").textContent = active ? "Jobs (running…)" : "Jobs";
  if (active) pollT = setTimeout(pollJobs, 1000);
}
export async function afterRender(shot, fillPanels) {
  await loadShots();
  const s = S.shots.find(q => q.name === shot);
  if (!fillPanels || !s?.renders[0]) return;
  let n = 0;
  for (const pg of S.doc.pages) for (const l of pg.layers) if (l.type === "panel" && l.shot === shot && (!l.image || !l.lockImage)) {
    const keep = l.image ? { fit: l.image.fit, focus: l.image.focus, zoom: l.image.zoom, flip: l.image.flip } : null;
    const dim = await imgSize(s.renders[0]);
    l.image = { ref: s.renders[0], iw: dim.w, ih: dim.h, fit: "cover", focus: [0.5, 0.3], zoom: 1, flip: false, ...(keep || {}) }; n++;
  }
  if (n) { commit(`New render placed in ${n} panel${n > 1 ? "s" : ""}`); requestDraw(); renderPageThumbs(); }
}
/* a finished cut-out: every panel showing that render breaks out of its frame */
export function mattesReady(ref) {
  const m = matteRef(ref); let n = 0;
  for (const pg of S.doc.pages) for (const l of pg.layers) if (l.type === "panel" && l.image?.ref === ref) {
    l.image = { ...l.image, matte: m }; l.breakout ||= { reach: 160, sides: "trbl" }; n++;
  }
  for (const k of [...IMG.keys()]) if (k.startsWith(m + "|")) IMG.delete(k);      // a re-cut replaces the file under the same name
  if (n) { commit(`Characters cut out: ${n} panel${n > 1 ? "s" : ""} break out of the frame`); requestDraw(); renderPageThumbs(); refreshProps(); }
}
export function toggleJobs(show) { ui.jobsOpen = show ?? !ui.jobsOpen; renderJobs(); }
export function viewJob(id) { S.jobView = id; renderJobs(); }
export async function closeJob(id) {
  const j = S.jobs[id]; if (!j) return;
  if (!j.done && !confirm(`Stop "${j.label}"? It is still running.`)) return;
  try { await post(`/api/jobs/${id}/cancel`); } catch { }          // already gone on the server is fine
  j.done = true; delete S.jobs[id];
  if (S.jobView === id) S.jobView = Object.keys(S.jobs).pop() || null;
  renderJobs(); pollJobs();
}
/* the drawer is src/ui/JobsDrawer.svelte: this hands it what to show */
export function renderJobs() {
  const js = Object.values(S.jobs).reverse();
  ui.jobs = js.map(j => ({ id: j.id, label: j.label, state: j.done ? (j.code === 0 ? "ok" : "bad") : "run" }));
  const j = S.jobs[S.jobView] || js[0];
  ui.jobView = j ? j.id : null;
  ui.jobLog = j ? j.lines.join("\n") : "";
}
export async function refreshPod(force) {
  const pill = $("#podpill");
  if (force) { pill.textContent = "pod: checking…"; pill.className = "pill"; }
  try {
    S.pod = await api("/api/pod");
    const p = S.pod;
    pill.className = "pill " + (p.ready ? "ok" : p.running ? "warn" : "off");
    pill.textContent = p.target !== "runpod" ? `local ComfyUI` : p.ready ? "pod ready" : p.running ? "pod starting" : (p.text.match(/: (\w+)/)?.[1] || "pod off").toLowerCase();
    pill.title = p.text;
  } catch (e) { pill.textContent = "pod ?"; pill.title = e.message; }
}

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_jobs() {
  $("#jobsbtn").onclick = () => toggleJobs();


  $("#podpill").onclick = e => {
    const r = e.target.getBoundingClientRect();
    popMenu(r.right - 240, r.bottom + 4, [[S.pod?.text || "status unknown", () => {}, "", true], null, ["Refresh", () => refreshPod(true)],
      ["Open ComfyUI", () => window.open(S.pod.url, "_blank"), "", !S.pod?.url], ["Start pod", () => podAction("start")], ["Stop pod", () => podAction("stop")]]);
  };
}
