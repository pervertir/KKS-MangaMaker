import { status } from "./misc.js";
import { S } from "./state.js";
import { requestDraw } from "./view.js";

/* ================================================================ image adjust (panel crop) */
export function enterAdjust(l) { S.adjust = l.id; S.sel = l.id; status("Drag to reposition the render, scroll to zoom, Esc when done"); requestDraw(); }
export function exitAdjust() { S.adjust = null; status(""); requestDraw(); }
