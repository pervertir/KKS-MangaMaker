import { $, $$, api, clamp } from "./core.js";
import { applyThemeChrome } from "./creation.js";
import { setDockTab } from "./dock-tabs.js";
import { refreshPod } from "./jobs.js";
import { PRESET_LAYOUTS, applyLayout, gridRects } from "./layouts.js";
import { renderLibrary } from "./library.js";
import { buildMenus, popMenu } from "./menus.js";
import { status, toast } from "./misc.js";
import { renderPages } from "./pages.js";
import { loadDoc, openProject, setName } from "./project.js";
import { S, newDoc, normalize } from "./state.js";
import { buildToolbar, center, sc, setTool } from "./tools.js";
import { fitView, zoomAt } from "./view.js";


/* runs once at start-up, in the original order (see main.js) */
export function init_editor_boot() {
  /* ================================================================ boot */
  (async function boot() {
    buildMenus(); buildToolbar(); applyThemeChrome();
    status("Loading templates (first start indexes 104 bubbles and 100 layouts)…");
    S.cat = await api("/api/catalog");
    S.shots = await api("/api/shots").catch(() => []);
    status("");
    setTool("move"); renderLibrary();
    const last = localStorage.getItem("mm.last");
    let auto = null; try { auto = JSON.parse(localStorage.getItem("mm.autosave") || "null"); } catch { }
    if (auto?.doc && confirm("Restore the unsaved work from your last session?")) { loadDoc(normalize(auto.doc), auto.name); S.dirty = true; setName(auto.name); }
    else if (last && (await api("/api/projects").catch(() => [])).includes(last)) await openProject(last);
    else {
      const doc = newDoc("Chapter 1");
      const L = S.cat.layouts.find(l => l.n === 13) || S.cat.layouts[0];
      loadDoc(doc, "");
      if (L) applyLayout(L.rects, "#" + L.n); else applyLayout(gridRects(...PRESET_LAYOUTS[6].slice(1)), PRESET_LAYOUTS[6][0]);
      S.undo = []; S.dirty = false; setName("");
    }
    localStorage.removeItem("mm.autosave");
    refreshPod(); setInterval(refreshPod, 30000);
  })().catch(e => { toast("Startup failed: " + e.message, "err"); console.error(e); });

  /* Properties folds away from its header, so the list under it can take the whole dock */
  {
    const panel = $("#propspanel");
    try { if (localStorage.getItem("mm.fold.propspanel") === "1") panel.classList.add("collapsed"); } catch { }
    $(".dockhead", panel).addEventListener("click", e => {
      if (e.target.closest("button")) return;
      panel.classList.toggle("collapsed");
      try { localStorage.setItem("mm.fold.propspanel", panel.classList.contains("collapsed") ? "1" : "0"); } catch { }
    });
  }

  /* dock tabs: the first run opens on Panels (the pipeline starts there), later runs on the tab last picked by hand */

  { let t = null; try { t = localStorage.getItem("mm.dock.tab"); } catch { } setDockTab(t || "panels"); }

  /* dock geometry: its width (grip on the left edge) and the Properties / list split, both remembered.
     The values live in CSS variables on the root, so the jobs drawer and the layout follow without code. */
  (function dockResize() {
    const root = document.documentElement, dock = $("#dock");
    const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
    const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { } };
    const w = +get("mm.dock.w"), sp = +get("mm.dock.split");
    if (w >= 280 && w <= 480) root.style.setProperty("--dock-w", w + "px");
    if (sp >= 20 && sp <= 70) root.style.setProperty("--dock-split", sp + "%");
    const dragger = (el, key, prop, unit, at) => {
      el.addEventListener("pointerdown", e => {
        if (e.button) return;
        e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { }
        el.classList.add("drag"); document.body.classList.add("resizing");
        let v = null;
        const move = ev => { v = at(ev); root.style.setProperty(prop, v + unit); };
        const up = () => {
          el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
          el.classList.remove("drag"); document.body.classList.remove("resizing"); if (v != null) put(key, v);
        };
        el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
      });
      el.addEventListener("dblclick", () => { root.style.removeProperty(prop); put(key, null); });
    };
    dragger($("#dockgrip"), "mm.dock.w", "--dock-w", "px", e => Math.round(clamp(dock.getBoundingClientRect().right - e.clientX, 280, 480)));
    dragger($("#docksplit"), "mm.dock.split", "--dock-split", "%", e => { const r = dock.getBoundingClientRect(); return Math.round(clamp((e.clientY - r.top) / r.height * 100, 20, 70)); });
  })();

  /* status bar: zoom lives in one place; the page strip can be put away (narrow windows start without it) */
  $("#zoomin").onclick = () => zoomAt(1.25, ...center());

  $("#zoomout").onclick = () => zoomAt(0.8, ...center());

  $("#st-zoom").onclick = e => {
    const r = e.currentTarget.getBoundingClientRect(), pop = $("#menu-pop");
    popMenu(r.left, r.top, [["Fit page", fitView, sc("Fit page")], ["Actual pixels (100%)", () => zoomAt(1 / S.view.s, ...center()), sc("Actual pixels")],
      ["Zoom in", () => zoomAt(1.25, ...center()), sc("Zoom in")], ["Zoom out", () => zoomAt(0.8, ...center()), sc("Zoom out")]]);
    pop.style.top = Math.max(8, r.top - pop.offsetHeight - 4) + "px";       // opens upward, clear of the bar
  };

  {
    const set = show => { document.body.classList.toggle("pages-on", show); document.body.classList.toggle("pages-off", !show); };
    try { const v = localStorage.getItem("mm.pages"); if (v === "1" || v === "0") set(v === "1"); } catch { }
    $("#pagesbtn").onclick = () => {
      const show = getComputedStyle($("#pagenav")).display === "none";
      set(show); try { localStorage.setItem("mm.pages", show ? "1" : "0"); } catch { }
      if (show && S.doc) renderPages();
    };
  }
}
