/* Entry point. Modules declare; the init functions below run their start-up code in a fixed order. */
import "./styles/app.css";
import "./styles/wizard.css";
import { attach } from "./ui/mount.js";
import JobsDrawer from "./ui/JobsDrawer.svelte";
import Toasts from "./ui/Toasts.svelte";
import * as m0 from "./editor/core.js";
import * as m1 from "./editor/state.js";
import * as m2 from "./editor/history.js";
import * as m3 from "./editor/images.js";
import * as m4 from "./editor/text.js";
import * as m5 from "./editor/drawing.js";
import * as m6 from "./editor/manga-tools.js";
import * as m7 from "./editor/view.js";
import * as m8 from "./editor/hit.js";
import * as m9 from "./editor/snapping.js";
import * as m10 from "./editor/pointer.js";
import * as m11 from "./editor/creation.js";
import * as m12 from "./editor/inline-edit.js";
import * as m13 from "./editor/adjust.js";
import * as m14 from "./editor/tools.js";
import * as m15 from "./editor/actions.js";
import * as m16 from "./editor/preferences.js";
import * as m17 from "./editor/layouts.js";
import * as m18 from "./editor/props.js";
import * as m19 from "./editor/layers.js";
import * as m20 from "./editor/panels-tab.js";
import * as m21 from "./editor/dock-tabs.js";
import * as m22 from "./editor/library.js";
import * as m23 from "./editor/options.js";
import * as m24 from "./editor/pages.js";
import * as m25 from "./editor/menus.js";
import * as m26 from "./editor/modal.js";
import * as m27 from "./editor/shots.js";
import * as m28 from "./editor/jobs.js";
import * as m29 from "./editor/project.js";
import * as m30 from "./editor/misc.js";
import * as m31 from "./editor/boot.js";
import * as m32 from "./pose/model.js";
import * as m33 from "./pose/scene.js";
import * as m34 from "./pose/geometry.js";
import * as m35 from "./pose/draw.js";
import * as m36 from "./pose/view.js";
import * as m37 from "./pose/ik.js";
import * as m38 from "./pose/pointer.js";
import * as m39 from "./pose/presets.js";
import * as m40 from "./pose/library.js";
import * as m41 from "./pose/side.js";
import * as m42 from "./pose/open.js";
import * as m43 from "./pose/wiring.js";
import * as m44 from "./wizard/script.js";
import * as m45 from "./wizard/editor.js";
import * as m46 from "./wizard/prompt.js";
import * as m47 from "./helpers/checker.js";
import * as m48 from "./helpers/starters.js";
import * as m49 from "./helpers/cast.js";
import * as m50 from "./helpers/manga.js";
import * as m51 from "./helpers/tips.js";
import * as m52 from "./helpers/guide.js";
import * as m53 from "./helpers/wiring.js";

m0.init_editor_core();
m10.init_editor_pointer();
m12.init_editor_inline_edit();
m14.init_editor_tools();
m15.init_editor_actions();
m21.init_editor_dock_tabs();
m22.init_editor_library();
m24.init_editor_pages();
m26.init_editor_modal();
m28.init_editor_jobs();
m29.init_editor_project();
m30.init_editor_misc();
m31.init_editor_boot();
m43.init_pose_wiring();
m53.init_helpers_wiring();

/* Svelte components that are always on screen */
attach(JobsDrawer);
attach(Toasts);

/* Every export is also readable as a global: index.html's inline handlers, the browser console and the
   automated checks address the editor that way. Read-only views of the live bindings. */
for (const mod of [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21, m22, m23, m24, m25, m26, m27, m28, m29, m30, m31, m32, m33, m34, m35, m36, m37, m38, m39, m40, m41, m42, m43, m44, m45, m46, m47, m48, m49, m50, m51, m52, m53])
  for (const k of Object.keys(mod))        // skips real window members (status, ...); element ids (#layers, #pages) are not own properties
    if (!Object.prototype.hasOwnProperty.call(window, k)) Object.defineProperty(window, k, { get: () => mod[k], configurable: true });
