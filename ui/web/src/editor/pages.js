import { exitAdjust } from "./adjust.js";
import { $, $$, clamp, deep, h, uid } from "./core.js";
import { commit, snapshot } from "./history.js";
import { layoutDialog } from "./layouts.js";
import { drawPage } from "./manga-tools.js";
import { popMenu } from "./menus.js";
import { refreshPanels, toast } from "./misc.js";
import { bleedPx, pageWidth, slotLabel, slotOf, spreadMisplaced } from "./book.ts";
import { H, S, page } from "./state.ts";
import { dialog } from "../ui/mount.ts";
import BookFormat from "../ui/BookFormat.svelte";
import { sc } from "./tools.js";
import { PC, fitView, requestDraw } from "./view.js";

/* ================================================================ pages strip */
export let thumbT = null;
export function schedThumbs(all) { S.thumbAll ||= !!all; clearTimeout(thumbT); thumbT = setTimeout(() => { renderPageThumbs(!S.thumbAll); S.thumbAll = false; }, 250); }
export function pageThumb(i, cls = "", w = 192) {
  const pg = S.doc.pages[i], k = pageWidth(S.doc, pg) / S.doc.width;
  const c = h("canvas", { width: Math.round(w * k), height: Math.round(w * H() / S.doc.width), "data-page": i });
  const vertical = !cls.includes("ov");
  const label = slotLabel(S.doc, i), bad = spreadMisplaced(S.doc, i);
  const el = h("div", { class: "pthumb " + cls + (i === S.page ? " on" : "") + (pg.span === 2 ? " wide" : "") + (bad ? " misplaced" : ""), draggable: true,
    title: (pg.span === 2 ? `Pages ${label} (spread)` : `Page ${label}`) + (pg.chapter ? ` · ${pg.chapter}` : "") + (bad ? " · this spread starts on a right-hand page" : ""),
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
    } }, c, h("div", {}, (pg.chapter ? "§ " : "") + label));
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
    const pw = pageWidth(S.doc, pg);
    g.setTransform(c.width / pw, 0, 0, c.height / H(), 0, 0); drawPage(g, pg, { export: false, rs: c.width / pw });
  });
}
/* whole book as it opens: page slots paired into sheets, slot 1 alone on the recto, a spread fills a pair */
export function bookRows(doc) {
  const rows = [];
  let open = null;
  doc.pages.forEach((pg, i) => {
    const s = slotOf(doc, i);
    if (pg.span === 2) { rows.push({ spread: i }); open = null; }
    else if (s % 2 === 0) { open = { verso: i }; rows.push(open); }
    else if (open && open.recto == null && s > 1) open.recto = i;
    else rows.push({ recto: i });
    if (pg.span !== 2 && s % 2) open = null;
  });
  return rows;
}
export function renderOverview() {
  const grid = $("#ovgrid"); grid.innerHTML = "";
  const n = S.doc.pages.length, rtl = S.doc.reading !== "ltr", spreads = $("#ovspreads").checked;
  $("#ovtitle").textContent = `${S.doc.title} · ${n} page${n > 1 ? "s" : ""}`;
  if (!spreads) { S.doc.pages.forEach((_, i) => grid.append(pageThumb(i, "ov", 300))); renderPageThumbs(); return; }
  for (const row of bookRows(S.doc)) {
    if (row.spread != null) { grid.append(h("div", { class: "spread" }, pageThumb(row.spread, "ov", 300))); continue; }
    const cell = i => i == null ? h("div", { class: "ghostpage" }) : pageThumb(i, "ov", 300);
    const cells = [cell(row.verso), cell(row.recto)];                              // left to right in a ltr book
    if (rtl) cells.reverse();                                                      // manga: the recto is on the left
    grid.append(h("div", { class: "spread" }, ...cells));
  }
  renderPageThumbs();
}
export function toggleOverview(show) {
  const ov = $("#overview"); ov.hidden = !(show ?? ov.hidden);
  if (!ov.hidden) renderOverview();
}
export function gotoPage(i) {
  if (S.adjust) exitAdjust();
  const was = pageWidth(S.doc, page());
  S.page = clamp(i, 0, S.doc.pages.length - 1); S.sel = null; snapshot(); refreshPanels(); renderPages(); requestDraw();
  if (pageWidth(S.doc, page()) !== was) fitView();
}
export const pageOps = {
  add() { S.doc.pages.splice(S.page + 1, 0, { id: uid(), bg: "#ffffff", layers: [] }); S.page++; commit("Page added"); renderPages(); requestDraw(); if ($("#overview").hidden) layoutDialog(); },
  dup() { const c = deep(page()); c.id = uid(); c.layers.forEach(l => l.id = uid()); S.doc.pages.splice(S.page + 1, 0, c); S.page++; commit("Page duplicated"); renderPages(); requestDraw(); },
  del(fromKey) { if (S.doc.pages.length < 2) return toast("A project needs one page"); if (!fromKey && !confirm(`Delete page ${S.page + 1}?`)) return;
    const n = S.page + 1; S.doc.pages.splice(S.page, 1); S.page = Math.max(0, S.page - 1); S.sel = null; commit("Page deleted");
    renderPages(); if (!$("#overview").hidden) renderOverview(); refreshPanels(); requestDraw(); toast(`Deleted page ${n} — ⌘Z brings it back`); },
  left() { if (S.page < 1) return; const p = S.doc.pages.splice(S.page, 1)[0]; S.doc.pages.splice(--S.page, 0, p); commit(); renderPages(); },
  spread() {
    const pg = page(), b = bleedPx(S.doc);
    if (pg.span === 2) {
      if (!confirm("Make this spread a single page? Art on the second half is kept but falls outside the page.")) return;
      if (S.doc.reading !== "ltr") for (const l of pg.layers) l.x -= S.doc.width - 2 * b;
      delete pg.span;
    } else {
      pg.span = 2;
      // manga reads right to left, so the page as it was becomes the right half
      if (S.doc.reading !== "ltr") for (const l of pg.layers) l.x += S.doc.width - 2 * b;
    }
    commit(pg.span === 2 ? "Page made a spread" : "Spread made a page"); renderPages(); fitView(); requestDraw();
    if (spreadMisplaced(S.doc, S.page)) toast("This spread starts on a right-hand page: add or remove a page before it so it opens flat");
  },
  numbered() { const pg = page(); if (pg.noNumber) delete pg.noNumber; else pg.noNumber = true; commit(pg.noNumber ? "Page number hidden" : "Page number shown"); renderPages(); requestDraw(); },
  chapter() {
    const pg = page(), t = prompt("Chapter title (leave empty to remove the chapter break)", pg.chapter || "");
    if (t == null) return;
    if (t.trim()) pg.chapter = t.trim(); else delete pg.chapter;
    commit(pg.chapter ? "Chapter starts here" : "Chapter break removed"); renderPages();
  },
  format() { dialog(BookFormat, "Book format & page numbers", "small"); },
  right() { if (S.page >= S.doc.pages.length - 1) return; const p = S.doc.pages.splice(S.page, 1)[0]; S.doc.pages.splice(++S.page, 0, p); commit(); renderPages(); },
};
export const pageMenu = () => [["Add page after", pageOps.add, sc("New page")], ["Duplicate page", pageOps.dup, sc("Duplicate page")], ["Move page earlier", pageOps.left, sc("Move page earlier")],
  ["Move page later", pageOps.right, sc("Move page later")], null,
  [page().span === 2 ? "Make single page" : "Make two-page spread", pageOps.spread], [page().noNumber ? "Show page number" : "No page number", pageOps.numbered],
  [page().chapter ? `Chapter: ${page().chapter}…` : "Start a chapter here…", pageOps.chapter], ["Book format & page numbers…", pageOps.format], null,
  ["Delete page", pageOps.del, sc("Delete page")]];

/* runs once at start-up, in the original order (see main.js) */
export function init_editor_pages() {
  $("#ovbtn").onclick = () => toggleOverview();

  $("#ovclose").onclick = () => toggleOverview(false);

  $("#ovspreads").onchange = renderOverview;

  $("#ovadd").onclick = () => { S.page = S.doc.pages.length - 1; pageOps.add(); };

  $("#addpage").onclick = () => pageOps.add();
}
