import { $, h } from "../editor/core.js";
import { toast } from "../editor/misc.js";
import { S } from "../editor/state.js";

/* ================================================================ tips */
export const TIPS = {
  move: "Click to select, drag to move. Corner handles resize, the round handle rotates. Alt-drag duplicates. Double-click a bubble to type, a panel to reposition its render.",
  hand: "Drag to pan. Hold Space with any tool to pan, Ctrl/⌘ + scroll to zoom.",
  panel: "Drag a frame. Keep gutters (the white gaps) even: about 30 px on this page. Break a panel border only for a big moment.",
  bubble: "Click a panel to drop a template bubble; pick the shape in Bubbles. One idea per bubble, under ~100 characters.",
  vbubble: "Drag to draw a bubble; drag the tail tip toward the speaker's mouth. Oval = speech, cloud = thought, burst = shout, dashed = whisper.",
  text: "Free text with no balloon: narration or off-panel voices. Keep it inside the green safe area.",
  sfx: "Sound effects are part of the art: big, tilted, overlapping the panel. Short words read best (BAM, DOKI).",
  caption: "Captions set time and place (\"The next day.\"). Put them in the panel's top corner where reading starts.",
  tone: "Screentone adds shade without colour. Gradients set mood (dark top = night or dread). Click a panel to fill it.",
  speed: "Focus lines pull the eye to a centre (surprise, impact); parallel lines show motion.",
  page: `Manga reads ${"right to left"}, top to bottom, panel by panel, then bubble by bubble the same way. Big panel = big moment.`,
};
export const TIPS_ON = () => { try { return localStorage.getItem("mm.tips") !== "0"; } catch { return true; } };
export function showTip(tool) {
  let el = $("#tipcard");
  if (!TIPS_ON() || S.mode === "pose") { if (el) el.hidden = true; return; }
  if (!el) {
    el = h("div", { id: "tipcard" }, h("span", { class: "tt" }), h("button", { class: "ghost", title: "Turn tips off (Help menu turns them back on)", onclick: () => { try { localStorage.setItem("mm.tips", "0"); } catch { } el.hidden = true; } }, "✕"));
    $("#stage").append(el);
  }
  el.hidden = false; $(".tt", el).textContent = "💡 " + (TIPS[tool] || TIPS.page);
}
export function toggleTips() { try { localStorage.setItem("mm.tips", TIPS_ON() ? "0" : "1"); } catch { } showTip(S.tool); toast("Tips " + (TIPS_ON() ? "on" : "off")); }
