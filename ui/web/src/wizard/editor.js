import { h } from "../editor/core.js";
import { toast } from "../editor/misc.js";
import { wizScan } from "./script.js";

/* ================================================================ script editor (highlighted textarea) */
/* The textarea stays the real editor (native undo, IME, selection); its text is transparent and a layer
   with the same metrics sits under it, one block per line. Only colour, background and underline differ
   between tokens: anything that changed a glyph's width would let the two drift apart. */
export function wizPaint(host, rows) {
  const kids = host.children;
  rows.forEach((r, i) => {
    const gut = r.gut || String(i + 1), key = gut + "\u0001" + r.toks.map(t => t[0] + "\u0002" + t[1] + (t[2] ? "!" : "")).join("\u0003");
    const old = kids[i];
    if (old && old._k === key) return;
    const el = h("div", { class: "wl" + (r.gut ? " pn" : "") + (r.warn.length ? " wn" : ""), "data-g": gut });
    for (const [t, c, w] of r.toks) el.append(c || w ? h("span", { class: (c ? c.split(" ").map(x => "wz-" + x).join(" ") : "") + (w ? " wz-warn" : "") }, t) : t);
    if (!r.toks.length) el.append("​");               // an empty line still needs its line box
    el._k = key; old ? old.replaceWith(el) : host.append(el);
  });
  while (kids.length > rows.length) host.lastChild.remove();
}

/* ```fenced``` answers paste as the bare script: the fenced blocks anywhere in the text (chat models like
   to add a sentence around them; several blocks are joined), or what follows a fence that was never
   closed. A fence line is never script, left in it would become a panel. Anything else is untouched. */
export function wizUnfence(text) {
  const t = String(text).replace(/\r\n?/g, "\n");
  const m = [...t.matchAll(/^[ \t]*(```+|~~~+)[^\n`]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm)];
  if (m.length) return m.map(x => x[2]).join("\n");
  const cut = t.match(/^(?:[\s\S]*?\n)?[ \t]*(?:```+|~~~+)[^\n`]*\n([\s\S]*)$/);
  return cut && cut[1].trim() ? cut[1] : text;
}

export function wizEditor(per, onScan) {
  const ta = h("textarea", { spellcheck: "false", wrap: "soft", autocomplete: "off", autocapitalize: "off", "aria-label": "Script" });
  const hl = h("div", { class: "wizhl", "aria-hidden": "true" }), list = h("div", { class: "wizwarn", hidden: true });
  const el = h("div", { class: "wized" }, hl, ta);
  let raf = 0;
  const scroll = () => { hl.style.transform = `translateY(${-ta.scrollTop}px)`; };
  const go = i => {
    const v = ta.value; let a = 0; for (let k = 0; k < i; k++) a = v.indexOf("\n", a) + 1;
    const b = v.indexOf("\n", a); ta.focus(); ta.setSelectionRange(a, b < 0 ? v.length : b);
    const row = hl.children[i]; if (row) ta.scrollTop = Math.max(0, row.offsetTop - ta.clientHeight / 3);
  };
  const paint = () => {
    raf = 0;
    const scan = wizScan(ta.value, per());
    hl.style.width = ta.clientWidth + "px";                // a scrollbar appearing narrows the textarea's lines; follow it
    wizPaint(hl, scan.rows); scroll();
    list.hidden = !scan.warns.length;
    list.replaceChildren(...scan.warns.slice(0, 60).map(w => h("button", { class: "ghost", title: "Go to this line", onclick: () => go(w.line) }, h("b", {}, `Line ${w.line + 1}`), ` ${w.msg}`)));
    onScan && onScan(scan);
  };
  const refresh = () => { if (!raf) raf = requestAnimationFrame(paint); };
  /* typed through the browser's own editing so ⌘Z still walks back through it */
  const insert = text => {
    ta.focus();
    let ok = false; try { ok = document.execCommand("insertText", false, text); } catch { }
    if (!ok) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end"); refresh(); }
  };
  ta.addEventListener("input", refresh);
  ta.addEventListener("scroll", scroll);
  ta.addEventListener("paste", e => {
    const raw = e.clipboardData ? e.clipboardData.getData("text/plain") : "", clean = raw && wizUnfence(raw);
    if (!raw || clean === raw) return;
    e.preventDefault(); insert(clean); toast("Removed the code fence around the pasted script", "ok");
  });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(refresh).observe(ta);
  return { el, ta, list, refresh, go, set: v => { ta.focus(); ta.select(); insert(v); } };
}
