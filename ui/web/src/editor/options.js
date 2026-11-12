import { $, h } from "./core.js";
import { showLib } from "./dock-tabs.js";
import { thumb } from "./images.js";
import { layoutDialog } from "./layouts.js";
import { PRESETS } from "../lettering/geom.ts";
import { S, bubbleMeta } from "./state.ts";
import { TONE_PRESETS } from "./tools.js";
import { getTool } from "../core/tools.ts";

/* ================================================================ options bar */
/* three zones: the tool's own controls, a hint that is the first thing to give way, and Snap, which never scrolls away */
export function renderOptions() {
  const o = $("#optionsbar"); o.innerHTML = "";
  const name = { move: "Move", hand: "Hand", panel: "Panel", bubble: "Bubble", vbubble: "Drawn bubble", text: "Text", sfx: "Sound effect", caption: "Caption",
    tone: "Screentone", speed: "Speed lines" }[S.tool] || getTool(S.tool)?.label;
  const L = h("div", { class: "ob-l" }, h("span", { class: "tname" }, name)), hint = h("div", { class: "ob-hint" });
  const say = t => { hint.textContent = t; hint.title = t; };
  const seg = (opts, cur, pick) => h("div", { class: "seg" }, ...opts.map(([k, t, tip]) =>
    h("button", { class: cur === k ? "on" : "", title: tip, "aria-pressed": String(cur === k), onclick: () => { pick(k); renderOptions(); } }, t)));
  if (S.tool === "move") say("Drag to move · Alt-drag duplicates · ⌘-click picks the panel under a bubble · Shift locks axis · Ctrl disables snapping");
  if (S.tool === "panel") { L.append(h("button", { onclick: layoutDialog }, "Layouts…")); say("Drag a frame on the page. Snaps to page edges and 30 px gutters."); }
  if (S.tool === "bubble") {
    const m = bubbleMeta(S.bubble);
    L.append(h("img", { src: thumb(m.ref, 80) }), h("span", {}, "#" + m.key), h("button", { onclick: () => showLib("bubbles") }, "Pick bubble…"));
    say("Click to place, or drag to size it");
  }
  if (S.tool === "text" || S.tool === "sfx" || S.tool === "caption") say("Click to place, or drag a box. Type straight away; Esc when done.");
  if (S.tool === "hand") say("Drag to pan. Ctrl/⌘ + scroll zooms.");
  if (S.tool === "vbubble") {
    L.append(seg(PRESETS.map(([k, t]) => [k, k[0].toUpperCase() + k.slice(1), t]), S.vshape, k => { S.vshape = k; }));
    say("Click or drag to place; drag the pink dot to aim the tail");
  }
  if (S.tool === "tone") {
    L.append(h("select", { title: "Screentone preset", onchange: e => { S.tonePreset = +e.target.value; } },
      ...TONE_PRESETS.map(([t], i) => h("option", { value: i, selected: i === S.tonePreset }, t))));
    say("Click a panel to fill it (clipped to the panel), or drag an area. Use Multiply blend over renders.");
  }
  if (S.tool === "speed") {
    L.append(seg([["focus", "Focus", "Focus lines 集中線: wedges toward an empty centre"], ["parallel", "Speed", "Speed lines 流線: parallel streaks"]], S.speedMode, k => { S.speedMode = k; }));
    say("Click a panel to fill it, or drag an area. Tweak count, thickness and the empty centre in Properties.");
  }
  getTool(S.tool)?.options?.(L);
  o.append(L, hint, h("div", { class: "ob-r" },
    h("button", { class: "ghost", title: "Snapping guides (;)", "aria-pressed": String(S.showGuides), onclick: () => { S.showGuides = !S.showGuides; renderOptions(); } }, S.showGuides ? "Snap: on" : "Snap: off")));
}
