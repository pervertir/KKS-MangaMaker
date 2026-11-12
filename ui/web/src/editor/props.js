import { h } from "./core.js";
import { ui } from "../ui/store.svelte.ts";

/* ================================================================ properties
   The panel is src/ui/Props.svelte. rowOf is the label + controls row the dialogs still build by hand. */
export function rowOf(label, ...kids) { return h("div", { class: "row" }, h("label", {}, label), ...kids); }
/* the fields re-read the selection; nothing is rebuilt, so focus stays where it is */
export function refreshProps() { ui.rev++; }
