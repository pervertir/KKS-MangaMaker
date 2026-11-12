import { mount, unmount, type Component } from "svelte";
import { modal } from "../editor/modal.js";

/* A Svelte component as the content of the editor's dialog: the dialog keeps its title bar, Escape and
   click-outside handling; the component renders the body (and, if it wants one, a .mfoot footer). */
export function dialog(Comp: Component<any>, title: string, cls = "", props: Record<string, unknown> = {}) {
  const box = modal(title, cls) as HTMLElement & { _unmount?: () => void };
  box.querySelector(".mbody")?.remove();
  const app = mount(Comp, { target: box, props });
  box._unmount = () => unmount(app);
  return app;
}
export const attach = (Comp: Component<any>, target: Element = document.body, props: Record<string, unknown> = {}) => mount(Comp, { target, props });

/* use:node={element}: puts an element the editor already made (a cached thumbnail canvas) into the markup */
export function node(el: HTMLElement, child: Node | null | undefined) {
  const set = (c: Node | null | undefined) => { if (c && el.firstChild !== c) el.replaceChildren(c); };
  set(child);
  return { update: set };
}
