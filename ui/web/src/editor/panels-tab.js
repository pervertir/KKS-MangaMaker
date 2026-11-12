import { act } from "./actions.js";
import { enterAdjust } from "./adjust.js";
import { $, h } from "./core.js";
import { setPanelImage } from "./creation.js";
import { showLib } from "./dock-tabs.js";
import { commit } from "./history.js";
import { renderShot, toggleJobs } from "./jobs.js";
import { layoutDialog } from "./layouts.js";
import { popMenu } from "./menus.js";
import { refreshPanels, status } from "./misc.js";
import { shotDialog } from "./shots.js";
import { S, layers, selL } from "./state.js";
import { deleteSelected, sc, setTool } from "./tools.js";
import { panelOrder, requestDraw, requestView } from "./view.js";
import { poseForPanel } from "../pose/open.js";
import { ui } from "../ui/store.svelte.js";

/* ================================================================ panels tab */
/* The page's frames in reading order (panelOrder, the rule the pipeline uses), each with its shot, how far
   along it is and the one action that moves it on. The order comes from where the frames sit, so rows are
   not draggable: to change it, move the frames or apply a layout. */
export function panelState(l) {
  const s = l.shot ? S.shots.find(q => q.name === l.shot) : null;
  const jobs = l.shot ? Object.values(S.jobs).filter(j => j.body?.shot === l.shot && ["run", "render"].includes(j.body.cmd)) : [];
  const last = jobs[jobs.length - 1];
  const log = ["Log", () => { S.jobView = last.id; toggleJobs(true); }, "Show this render's log"];
  const pose = ["Pose…", () => poseForPanel(l), "Pose the characters for this panel"];
  const repo = ["Reposition", () => enterAdjust(l), "Drag the render inside the frame, scroll to zoom (Enter)"];
  if (last && !last.done) return { g: "◔", cls: "warn", text: "Rendering…", act: log };
  if (last && last.code !== 0) return { g: "✕", cls: "bad", text: "Render failed", act: log };
  if (!l.shot) return l.image ? { g: "●", cls: "ok", text: "Image", act: repo } : { g: "○", cls: "", text: "No pose", tip: "No shot and no pose yet", act: pose };
  if (s?.renders.length) return l.image ? { g: "●", cls: "ok", text: `Rendered · ${s.renders.length}`, act: repo }
    : { g: "◐", cls: "warn", text: "Not placed", tip: "Rendered, but the render is not in this panel yet", act: ["Place", () => setPanelImage(l, s.renders[0], s.name), "Put the newest render in this panel"] };
  if (l.image) return { g: "●", cls: "ok", text: "Image", act: repo };
  if (!s) return { g: "◌", cls: "warn", text: "Shot missing", tip: `There is no shot named ${l.shot} in shots/`, act: pose };
  if (!s.pose) return { g: "◌", cls: "warn", text: "Needs pose", tip: "The shot has no pose yet", act: pose };
  return { g: "◐", cls: "", text: "Posed", tip: "Posed, not rendered yet", act: ["Render", () => renderShot(l.shot), "Render this shot on the pod (R)", true] };
}
export function panelMenu(l) {
  return [["Pose…", () => poseForPanel(l)], ["Render on pod", () => renderShot(l.shot), sc("Render the panel's shot on the pod"), !l.shot],
    ["Edit shot…", () => shotDialog(l.shot || null), sc("Shots (edit, grab, render)")],
    ["Reposition render", () => enterAdjust(l), "↵", !l.image],
    ["Remove image", () => { l.image = null; commit("Image removed"); requestDraw(); }, "", !l.image], null,
    ["Split ⇆", () => act.split("v"), sc("Split panel side by side")], ["Split ⇅", () => act.split("h"), sc("Split panel top / bottom")],
    ["Duplicate", act.duplicate, sc("Duplicate layer")], [l.visible ? "Hide" : "Show", act.toggleHide, sc("Hide / show")],
    [l.locked ? "Unlock" : "Lock", act.toggleLock, sc("Lock / unlock")], null, ["Delete", deleteSelected, "Del"]];
}
/* The list itself is src/ui/PanelsPane.svelte. */
export function renderPanelsTab() { ui.rev++; }
export function toggleOrder() { S.showOrder = !S.showOrder; requestView(); renderPanelsTab(); }
