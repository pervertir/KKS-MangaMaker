import { exitAdjust } from "./adjust.js";
import { $, $$, clamp, deep, h, uid } from "./core.js";
import { commit, snapshot } from "./history.js";
import { layoutDialog } from "./layouts.js";
import { drawPage } from "./manga-tools.js";
import { popMenu } from "./menus.js";
import { refreshPanels, toast } from "./misc.js";
import { H, S, W, page } from "./state.js";
import { sc } from "./tools.js";
import { PC, requestDraw } from "./view.js";

/* ================================================================ pages strip */
export let thumbT = null;
export function schedThumbs(all) { S.thumbAll ||= !!all; clearTimeout(thumbT); thumbT = setTimeout(() => { renderPageThumbs(!S.thumbAll); S.thumbAll = false; }, 250); }
export function pageThumb(i, cls = "", w = 192) {
  const c = h("canvas", { width: w, height: w * 1.5, "data-page": i });
  const vertical = !cls.includes("ov");
  const el = h("div", { class: "pthumb " + cls + (i === S.page ? " on" : ""), title: `Page ${i + 1}`, draggable: true,
    onclick: () => { gotoPage(i); if (!$("#overview").hidden) toggleOverview(false); },
    oncontextmenu: e => { e.preventDefault(); gotoPage(i); popMenu(e.clientX, e.clientY, pageMenu()); },
    ondragstart: e => { e.dataTransfer.setData("text/page", String(i)); e.dataTransfer.effectAllowed = "move"; },
    ondragover: e => {
      if (!e.dataTransfer.types.includes("text/page")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), after = vertical ? e.clientY > r.top + r.height / 2 : (e.clientX > r.left + r.width / 2) !== (S.doc.reading !== "ltr");
      el.classList.remove("dropbefore", "dropafter", "dropleft", "dropright");
      el.classList.add(vertical ? (after ? "dropafter" : "dropbefore") : ((e.clientX > r.left + r.width / 2) ? "dropright" : "dropleft"));
      el.dataset.after = after ? "1" : "";
    },
    ondragleave: () => el.classList.remove("dropbefore", "dropafter", "dropleft", "dropright"),
    ondrop: e => {
      e.preventDefault(); el.classList.remove("dropbefore", "dropafter", "dropleft", "dropright");
      const from = +e.dataTransfer.getData("text/page");
      movePage(from, i + (el.dataset.after ? 1 : 0));
    } }, c, h("div", {}, i + 1));
  return el;
}
export function movePage(from, to) {
  if (from === to || from + 1 === to) return;
  const cur = S.doc.pages[S.page], pg = S.doc.pages.splice(from, 1)[0];
  S.doc.pages.splice(to > from ? to - 1 : to, 0, pg);
  S.page = S.doc.pages.indexOf(cur);
  commit("Page moved"); renderPages();
}
export function renderPages() {
  const box = $("#pages"); box.innerHTML = "";
  S.doc.pages.forEach((_, i) => box.append(pageThumb(i)));
  $("#pagecount").textContent = `Pages ${S.doc.pages.length}`;
  if (!$("#overview").hidden) renderOverview();
  renderPageThumbs();
  box.querySelector(".pthumb.on")?.scrollIntoView({ block: "nearest" });
}
export function renderPageThumbs(onlyCurrent) {
  $$("canvas[data-page]").forEach(c => {
    const i = +c.dataset.page, pg = S.doc.pages[i];
    if (!pg || (onlyCurrent && i !== S.page)) return;
    const g = c.getContext("2d");
    if (i === S.page && !PC.dirty && PC.key.startsWith(pg.id + "|")) { g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(PC.c, 0, 0, c.width, c.height); return; }
    g.setTransform(c.width / W(), 0, 0, c.height / H(), 0, 0); drawPage(g, pg, { export: false, rs: c.width / W() });
  });
}
/* whole book: spreads in reading order (page 1 opens on its own, like a printed volume) */
export function renderOverview() {
  const grid = $("#ovgrid"); grid.innerHTML = "";
  const n = S.doc.pages.length, rtl = S.doc.reading !== "ltr", spreads = $("#ovspreads").checked;
  $("#ovtitle").textContent = `${S.doc.title} · ${n} page${n > 1 ? "s" : ""}`;
  if (!spreads) { S.doc.pages.forEach((_, i) => grid.append(pageThumb(i, "ov", 300))); renderPageThumbs(); return; }
  const groups = [[0]];
  for (let i = 1; i < n; i += 2) groups.push(i + 1 < n ? [i, i + 1] : [i]);
  for (const g of groups) {
    let cells = g.map(i => pageThumb(i, "ov", 300));
    if (g[0] === 0) cells = [h("div", { class: "ghostpage" }), ...cells];          // page 1 sits on the right
    else if (cells.length === 1) cells.push(h("div", { class: "ghostpage" }));
    if (rtl && g[0] !== 0) cells.reverse();                                          // manga: the later page is on the left
    grid.append(h("div", { class: "spread" }, ...cells));
  }
  renderPageThumbs();
}
export function toggleOverview(show) {
  const ov = $("#overview"); ov.hidden = !(show ?? ov.hidden);
  if (!ov.hidden) renderOverview();
}
export function gotoPage(i) { if (S.adjust) exitAdjust(); S.page = clamp(i, 0, S.doc.pages.length - 1); S.sel = null; snapshot(); refreshPanels(); renderPages(); requestDraw(); }
export const pageOps = {
  add() { S.doc.pages.splice(S.page + 1, 0, { id: uid(), bg: "#ffffff", layers: [] }); S.page++; commit("Page added"); renderPages(); requestDraw(); if ($("#overview").hidden) layoutDialog(); },
  dup() { const c = deep(page()); c.id = uid(); c.layers.forEach(l => l.id = uid()); S.doc.pages.splice(S.page + 1, 0, c); S.page++; commit("Page duplicated"); renderPages(); requestDraw(); },
  del(fromKey) { if (S.doc.pages.length < 2) return toast("A project needs one page"); if (!fromKey && !confirm(`Delete page ${S.page + 1}?`)) return;
    const n = S.page + 1; S.doc.pages.splice(S.page, 1); S.page = Math.max(0, S.page - 1); S.sel = null; commit("Page deleted");
    renderPages(); if (!$("#overview").hidden) renderOverview(); refreshPanels(); requestDraw(); toast(`Deleted page ${n} — ⌘Z brings it back`); },
  left() { if (S.page < 1) return; const p = S.doc.pages.splice(S.page, 1)[0]; S.doc.pages.splice(--S.page, 0, p); commit(); renderPages(); },
  right() { if (S.page >= S.doc.pages.length - 1) return; const p = S.doc.pages.splice(S.page, 1)[0]; S.doc.pages.splice(++S.page, 0, p); commit(); renderPages(); },
};
export const pageMenu = () => [["Add page after", pageOps.add, sc("New page")], ["Duplicate page", pageOps.dup, sc("Duplicate page")], ["Move page earlier", pageOps.left, sc("Move page earlier")],
  ["Move page later", pageOps.right, sc("Move page later")], null, ["Delete page", pageOps.del, sc("Delete page")]];

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_pages() {
  $("#ovbtn").onclick = () => toggleOverview();

  $("#ovclose").onclick = () => toggleOverview(false);

  $("#ovspreads").onchange = renderOverview;

  $("#ovadd").onclick = () => { S.page = S.doc.pages.length - 1; pageOps.add(); };

  $("#addpage").onclick = () => pageOps.add();
}
