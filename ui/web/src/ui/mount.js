import { mount, unmount } from "svelte";
import { modal } from "../editor/modal.js";

/* A Svelte component as the content of the editor's dialog: the dialog keeps its title bar, Escape and
   click-outside handling; the component renders the body (and, if it wants one, a .mfoot footer). */
export function dialog(Component, title, cls = "", props = {}) {
  const box = modal(title, cls);
  box.querySelector(".mbody")?.remove();
  const app = mount(Component, { target: box, props });
  box._unmount = () => unmount(app);
  return app;
}
export const attach = (Component, target = document.body, props = {}) => mount(Component, { target, props });

/* use:node={element}: puts an element the editor already made (a cached thumbnail canvas) into the markup */
export function node(el, child) {
  const set = c => { if (c && el.firstChild !== c) el.replaceChildren(c); };
  set(child);
  return { update: set };
}
