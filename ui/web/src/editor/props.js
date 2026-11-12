import { h } from "./core.js";
import { ui } from "../ui/store.svelte.ts";
import { commit } from "./history.js";
import { startJob } from "./jobs.js";
import { status, toast } from "./misc.js";
import { S } from "./state.ts";
import { requestDraw } from "./view.js";
import { FRAME_SHAPES, tracePanel } from "./frames.js";
import { matteRef } from "./drawing.js";

/* ================================================================ properties
   The panel is src/ui/Props.svelte. rowOf is the label + controls row the dialogs still build by hand. */
export function rowOf(label, ...kids) { return h("div", { class: "row" }, h("label", {}, label), ...kids); }
/* the fields re-read the selection; nothing is rebuilt, so focus stays where it is */
export function refreshProps() { ui.rev++; }

/* Break out of frame: the characters, cut out with a matte made on the pod, drawn over the border */
export async function startBreakout(l) {
  const m = matteRef(l.image.ref);
  if (l.image.matte || (await fetch(`/img?ref=${encodeURIComponent(m)}&w=256`).then(r => r.ok, () => false))) {
    l.image.matte = m; l.breakout = { reach: 160, sides: "trbl" }; commit("Breaks out of its frame"); requestDraw(); refreshProps(); return;
  }
  cutOut(l);
}
export function cutOut(l) {
  if (!l.shot || !/\/render_[^/]+\.png$/.test(l.image.ref)) return toast("Break-out needs a shot render in the panel (cut-outs are made from shots/<shot>/out/render_*.png)", "err");
  if (S.pod && !S.pod.running) return toast("The pod isn't running: Pipeline › Start pod first", "err");
  startJob({ cmd: "matte", shot: l.shot, image: l.image.ref });
  status("Cutting the characters out on the pod…");
}
/* a tiny picture of a frame shape for the Properties buttons */
export function frameIcon(key) {
  const c = h("canvas", { width: 44, height: 44 }), g = c.getContext("2d"), s = FRAME_SHAPES.find(f => f[0] === key)[2];
  g.fillStyle = "#e9e9ee"; g.strokeStyle = "#111"; g.lineWidth = 3;
  const l = { x: 8, y: 6, w: 28, h: 32, ...s, radius: s.radius ? 8 : 0 };
  g.beginPath(); tracePanel(g, l); g.fill(); g.stroke();
  return c;
}
