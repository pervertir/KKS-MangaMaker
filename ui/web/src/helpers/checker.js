import { $, clamp, h, uid } from "../editor/core.js";
import { commit } from "../editor/history.js";
import { renderShot } from "../editor/jobs.js";
import { layoutDialog } from "../editor/layouts.js";
import { VTEXT } from "../editor/manga-tools.js";
import { refreshPanels } from "../editor/misc.js";
import { closeModal, modal } from "../editor/modal.js";
import { gotoPage, renderPageThumbs, renderPages } from "../editor/pages.js";
import { guides, safeArea, slotLabel, spreadMisplaced } from "../editor/book.ts";
import { H, S, W, bubbleMeta } from "../editor/state.ts";
import { fit } from "../editor/text.js";
import { panelOrder, requestDraw } from "../editor/view.js";
import { poseForPanel } from "../pose/open.js";
import { balloonText, merged } from "../lettering/index.ts";

/* ================================================================ page checker */
export const TEXT_TYPES = ["bubble", "vbubble", "balloon", "caption", "text"];
export const PRINT_MIN_PX = 28;          // ~8 pt on a B5 page at 1800 px wide: smaller is hard to read in print
export function safeRect(pg = S.doc.pages[S.page]) { return safeArea(S.doc, pg); }
export const boxOf = l => ({ x: l.x, y: l.y, w: l.w, h: l.h });
export const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
export const centreIn = (l, p) => { const cx = l.x + l.w / 2, cy = l.y + l.h / 2; return cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h; };
export function textBox(l) {                    // the box text is fitted into, as drawLayer does it
  if (l.type === "balloon") { const { sh } = balloonText(l); return [sh.w, sh.h, sh]; }
  if (l.type === "vbubble") { const k = VTEXT[l.shape] || [0.7, 0.64]; return [l.w * k[0], l.h * k[1]]; }
  if (l.type === "bubble") { const m = bubbleMeta(l.bubble); return m ? [l.w * (m.box[2] - m.box[0]) * 0.92, l.h * (m.box[3] - m.box[1]) * 0.92] : [l.w * 0.7, l.h * 0.6]; }
  return [l.w * 0.9, l.h * 0.86];
}
/* manga reading order for lettering inside a panel: top to bottom in bands, right to left (rtl) */
export function letterOrder(ls) {
  const rtl = S.doc.reading !== "ltr";
  return [...ls].sort((a, b) => {
    const band = Math.min(a.h, b.h) * 0.5;
    if (Math.abs(a.y - b.y) > band) return a.y - b.y;
    return rtl ? (b.x + b.w) - (a.x + a.w) : a.x - b.x;
  });
}

export function checkPage(pi) {
  const pg = S.doc.pages[pi], ls = pg.layers, out = [];
  const panels = panelOrder(ls), texts = ls.filter(l => TEXT_TYPES.includes(l.type) && l.visible);
  const add = (level, l, msg, fixLabel, fix) => out.push({ level, page: pi, id: l?.id, msg, fixLabel, fix });
  const pname = p => `panel ${panels.indexOf(p) + 1}`;
  if (!panels.length) add("warn", null, "This page has no panels.", "Choose a layout", () => { gotoPage(pi); layoutDialog(); });
  panels.forEach(p => {
    if (!p.image && !p.shot) add("info", p, `${pname(p)} has no render and no shot yet.`, "Pose it…", () => { gotoPage(pi); S.sel = p.id; poseForPanel(p); });
    else if (!p.image) add("info", p, `${pname(p)} (${p.shot}) is not rendered yet.`, "Render", () => renderShot(p.shot));
  });
  const safe = safeRect(pg), band = guides(S.doc, pg).gutter[0];
  if (spreadMisplaced(S.doc, pi)) add("warn", null, `The spread on pages ${slotLabel(S.doc, pi)} starts on a right-hand page, so its halves land on two different sheets.`,
    "Insert a page before it", () => { S.doc.pages.splice(pi, 0, { id: uid(), bg: "#ffffff", layers: [] }); renderPages(); });
  for (const l of texts) {
    const txt = (l.text || "").trim();
    const what = { bubble: "Bubble", vbubble: "Bubble", balloon: "Bubble", caption: "Caption", text: l.sfx ? "SFX" : "Text" }[l.type];
    if (!txt) { add("warn", l, `${what} with no text.`, "Delete it", () => { pg.layers.splice(pg.layers.indexOf(l), 1); }); continue; }
    const short = `"${txt.length > 28 ? txt.slice(0, 26) + "…" : txt}"`;
    if (!l.sfx) {
      const [bw, bh, sh] = textBox(l), f = fit(txt, l, bw, bh, S.doc.maxFont || 56, sh);
      if (f.px < PRINT_MIN_PX) add("warn", l, `${what} ${short}: text is ${f.px}px, too small to read in print.`, "Enlarge 25%", () => {
        const cx = l.x + l.w / 2, cy = l.y + l.h / 2; l.w *= 1.25; l.h *= 1.25; l.x = cx - l.w / 2; l.y = cy - l.h / 2; l.fontSize = 0;
      });
      if (txt.length > 140) add("info", l, `${what} ${short} holds ${txt.length} characters; manga bubbles read best under ~100. Split it in two.`, null, null);
    }
    const outside = l.x < safe.x || l.y < safe.y || l.x + l.w > safe.x + safe.w || l.y + l.h > safe.y + safe.h;
    if (outside && !l.sfx) add("warn", l, `${what} ${short} crosses the safe area: it may be cut off when printed.`, "Move inside", () => {
      l.x = clamp(l.x, safe.x, safe.x + safe.w - l.w); l.y = clamp(l.y, safe.y, safe.y + safe.h - l.h);
    });
    else if (band && !l.sfx && l.x < band.x + band.w && l.x + l.w > band.x) add("warn", l, `${what} ${short} sits on the spread's fold, where the binding swallows it.`, "Move off the fold", () => {
      const mid = band.x + band.w / 2;
      l.x = l.x + l.w / 2 < mid ? band.x - l.w : band.x + band.w;
    });
    if (l.type === "vbubble" && l.tail) {
      const home = panels.find(p => centreIn(l, p));
      const tx = l.x + l.w / 2 + l.tail.x, ty = l.y + l.h / 2 + l.tail.y;
      if (home && (tx < home.x || tx > home.x + home.w || ty < home.y || ty > home.y + home.h))
        add("warn", l, `Bubble ${short}: its tail points out of ${pname(home)}, away from the speaker.`, "Point inside", () => {
          l.tail = { x: (home.x + home.w / 2) - (l.x + l.w / 2), y: Math.max(l.h * 0.7, (home.y + home.h * 0.62) - (l.y + l.h / 2)) };
          const f = 1.45 / Math.max(0.01, Math.hypot(l.tail.x / (l.w / 2), l.tail.y / (l.h / 2))); l.tail.x *= f; l.tail.y *= f;
        });
    }
  }
  // overlaps between lettering
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (a.sfx || b.sfx || merged(a, b)) continue;
    const ov = overlapArea(boxOf(a), boxOf(b)) / Math.min(a.w * a.h, b.w * b.h);
    if (ov > 0.25) add("warn", b, `"${(b.text || "").slice(0, 20)}" covers "${(a.text || "").slice(0, 20)}".`, "Move apart", () => {
      const dy = (a.y + a.h) - b.y + 10; b.y = clamp(b.y + dy, 0, H() - b.h);
    });
  }
  // reading order: within each panel, the lines should be laid out in the order they were written
  for (const p of panels) {
    const inside = texts.filter(l => !l.sfx && l.type !== "caption" && centreIn(l, p));
    if (inside.length < 2) continue;
    const want = letterOrder(inside), written = [...inside].sort((a, b) => pg.layers.indexOf(a) - pg.layers.indexOf(b));
    if (want.some((l, i) => l !== written[i]))
      add("warn", written[0], `In ${pname(p)} the bubbles read in a different order than they were written (${S.doc.reading === "ltr" ? "left to right" : "right to left"}, top to bottom).`,
        "Reorder positions", () => {
          const slots = want.map(boxOf);                       // keep the places, move the lines into reading order
          written.forEach((l, i) => { const s2 = slots[i]; const cx = s2.x + s2.w / 2, cy = s2.y + s2.h / 2; l.x = cx - l.w / 2; l.y = cy - l.h / 2; });
        });
  }
  return out;
}

export function checkerDialog(all) {
  const box = modal(all ? "Check every page" : "Check this page", "mid");
  const body = $(".mbody", box);
  const render = () => {
    body.innerHTML = "";
    const idx = all ? S.doc.pages.map((_, i) => i) : [S.page];
    const items = idx.flatMap(checkPage);
    const warns = items.filter(i => i.level === "warn").length;
    body.append(h("p", { class: "hint", style: "margin-top:0" }, items.length
      ? `${warns} thing${warns === 1 ? "" : "s"} to fix, ${items.length - warns} note${items.length - warns === 1 ? "" : "s"}. Show selects the layer; Fix does the suggested change (undo works).`
      : "Nothing to fix: reading order, bubble tails, text size, print safe area and overlaps all look good."));
    const fixable = items.filter(i => i.fix && i.level === "warn");
    if (fixable.length > 1) body.append(h("div", { class: "btnrow" }, h("button", { class: "primary", onclick: () => {
      for (const it of fixable) if (!["Pose it…", "Render", "Choose a layout", "Insert a page before it"].includes(it.fixLabel)) it.fix();
      commit("Fixed " + fixable.length + " issues"); requestDraw(); renderPageThumbs(); render();
    } }, `Fix all ${fixable.length}`)));
    for (const it of items) body.append(h("div", { class: "checkrow " + it.level },
      h("span", { class: "lvl" }, it.level === "warn" ? "⚠" : "ℹ"),
      h("span", { class: "msg" }, (all ? `Page ${it.page + 1}: ` : "") + it.msg),
      it.id ? h("button", { onclick: () => { closeModal(); gotoPage(it.page); S.sel = it.id; refreshPanels(); requestDraw(); } }, "Show") : null,
      it.fix ? h("button", { onclick: () => { it.fix(); if (!["Pose it…", "Render", "Choose a layout"].includes(it.fixLabel)) { commit(it.fixLabel); requestDraw(); renderPageThumbs(); render(); } } }, it.fixLabel) : null));
  };
  render();
}
