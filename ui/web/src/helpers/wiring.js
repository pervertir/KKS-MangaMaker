import { MENUS, buildMenus } from "../editor/menus.js";
import { status } from "../editor/misc.js";
import { S } from "../editor/state.ts";
import { SC_MAP, SHORTCUTS, sc, setTool, set_setTool } from "../editor/tools.js";
import { castDialog, loadCast } from "./cast.js";
import { checkerDialog } from "./checker.js";
import { wizardGuide } from "./guide.js";
import { mangaDialog } from "./manga.js";
import { TIPS_ON, showTip, toggleTips } from "./tips.js";
import { loadPoseLib } from "../pose/library.js";
import { scriptWizard } from "../wizard/prompt.js";


/* runs once at start-up, in the original order (see main.js) */
export function init_helpers_wiring() {
  /* ================================================================ wiring */
  (function initHelpers() {
    const orig = setTool;
    set_setTool(function (t) { orig(t); showTip(S.tool); });           // eslint-disable-line no-global-assign
    const add = (menu, items) => { const f = MENUS[menu]; MENUS[menu] = () => [...f(), null, ...items()]; };
    add("Page", () => [["Check this page…", () => checkerDialog(false), sc("Check this page")], ["Check every page…", () => checkerDialog(true)], ["Make it manga…", mangaDialog]]);
    add("Pipeline", () => [["Character sheet…", castDialog, sc("Character sheet")]]);
    add("Help", () => [["Script Wizard guide", wizardGuide], [(TIPS_ON() ? "Hide" : "Show") + " tips", toggleTips], ["Starter templates…", () => scriptWizard("starter")]]);
    SHORTCUTS.push(["Page", "mod+shift+c", "Check this page", () => checkerDialog(false)], ["Pipeline", "mod+shift+u", "Character sheet", () => castDialog()]);
    for (const r of SHORTCUTS.slice(-2)) SC_MAP.set(r[1], r);
    buildMenus();
    loadCast();
    setTimeout(() => showTip(S.tool), 1500);
    // fetch the pose library while the editor is idle, so the Pose tab opens instantly
    (window.requestIdleCallback || (f => setTimeout(f, 2500)))(() => loadPoseLib().then(() => status("")), { timeout: 5000 });
  })();
}
