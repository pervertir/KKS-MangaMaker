import { commit } from "./history.js";
import { toast } from "./misc.js";
import { renderOptions } from "./options.js";
import { S, page } from "./state.ts";
import { ICON } from "./tools.js";
import { cv, requestDraw, requestView } from "./view.js";
import { cutFits, derivePage, hitCut, knifeCut, snapAngle } from "./knife.js";
import { registerTool } from "../core/tools.ts";

/* ================================================================ knife tool */
const pt = e => ({ x: e.raw.x, y: e.raw.y });
registerTool({
  id: "knife", label: "Knife: drag a line across panels to cut them", key: "x", icon: ICON.knife, group: "frame", order: 11,
  deactivate() { S.cut = null; },
  hover(e) { const hc = hitCut(pt(e)); cv.style.cursor = hc ? (hc.end == null ? "move" : "alias") : "crosshair"; },
  down(e) {
    const p = pt(e), hc = hitCut(p);
    S.cut = hc ? hc.cut.id : null; renderOptions();
    S.drag = { knife: hc ? { cut: hc.cut, end: hc.end, a0: [...hc.cut.a], b0: [...hc.cut.b], p0: p } : { draw: true, a: p, b: p } };
    requestView();
  },
  move(e) {
    const k = S.drag?.knife; if (!k) return;
    const p = pt(e), ev = e.native;
    if (k.draw) k.b = snapAngle(k.a, p, ev);
    else {
      const c = k.cut, dx = p.x - k.p0.x, dy = p.y - k.p0.y;
      if (k.end === 0) { const q = snapAngle({ x: k.b0[0], y: k.b0[1] }, p, ev); c.a = [+q.x.toFixed(1), +q.y.toFixed(1)]; }
      else if (k.end === 1) { const q = snapAngle({ x: k.a0[0], y: k.a0[1] }, p, ev); c.b = [+q.x.toFixed(1), +q.y.toFixed(1)]; }
      else { c.a = [k.a0[0] + dx, k.a0[1] + dy].map(v => +v.toFixed(1)); c.b = [k.b0[0] + dx, k.b0[1] + dy].map(v => +v.toFixed(1)); }
      if (cutFits(c)) { k.ok = [[...c.a], [...c.b]]; k.moved = true; derivePage(); }
      else if (k.ok) { c.a = k.ok[0]; c.b = k.ok[1]; }
      else { c.a = [...k.a0]; c.b = [...k.b0]; }
    }
    requestDraw();
  },
  up() {
    const k = S.drag?.knife; S.drag = null;
    if (!k) return;
    if (k.draw) {
      const n = knifeCut(k.a, k.b);
      if (n) { S.cut = page().cuts[page().cuts.length - 1]?.id || null; commit(n === 1 ? "Panel cut" : `${n} panels cut`); renderOptions(); }
      else if (Math.hypot(k.b.x - k.a.x, k.b.y - k.a.y) > 20) toast("Drag the line all the way across a panel, from outside one edge to outside the other");
    } else if (k.moved) commit(k.end == null ? "Cut moved" : "Cut turned");
    requestDraw();
  },
  cancel() {
    const k = S.drag?.knife;
    if (k && !k.draw) { k.cut.a = [...k.a0]; k.cut.b = [...k.b0]; derivePage(); }
    S.drag = null; requestDraw();
  },
});
