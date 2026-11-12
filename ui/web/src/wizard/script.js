import { clamp, post, uid } from "../editor/core.js";
import { commit } from "../editor/history.js";
import { gridRects } from "../editor/layouts.js";
import { refreshPanels, toast } from "../editor/misc.js";
import { renderPages } from "../editor/pages.js";
import { loadDoc } from "../editor/project.js";
import { loadShots } from "../editor/shots.js";
import { H, S, W, newDoc, normalize } from "../editor/state.js";
import { fitView, panelOrder, requestDraw } from "../editor/view.js";
import { enrichChars } from "../helpers/cast.js";

/* Script to pages: a scene written as plain lines becomes pages of panels with bubbles already placed
   in reading order, and (optionally) one shot per panel with its characters and prompt, ready to pose
   and render. Loaded after app.js and uses its helpers.

   Format (one thing per line):
     ---                         new page (pages are also split automatically)
     [Rem, Ram] Classroom...     a new panel; [..] = who is in it, left to right; the rest is the prompt
     ! Rem slams the door        "!" makes it a big panel
     Rem: Good morning!          speech        Rem (thought): ...   thought   Rem (shout): ...   shout
     Ram (whisper): psst         whisper       Caption: The next day.        SFX: BAM            */

export const WIZ_EXAMPLE = `[Rem] Classroom after school, sunset through the windows. Rem waits by the door.
Rem: He said he'd come...
Rem (thought): Maybe he forgot.
SFX: TAP TAP
[Subaru] Subaru runs down the hallway, out of breath.
Subaru (shout): Rem! Sorry I'm late!
! [Rem, Subaru] Rem turns around, surprised and happy.
Rem: Subaru-kun!
Caption: Five minutes earlier...
[Ram] Ram on the rooftop, arms crossed, smirking.
Ram (whisper): Honestly, those two.`;

/* One line of a script, classified once: parseScript builds pages from it and the editor colours it, so
   the highlighting can never disagree with what gets built. toks = [text, class] pieces that join back
   to the raw line exactly (the overlay must match the textarea character for character). */
export const WIZ_RE = {
  page: /^(-{3,}|#\s*page\b.*|page\s*\d*\s*:?)$/i,
  koma: /4[\s-]?koma|yonkoma/i,
  title: /^(title)(\s*:\s*)(.+)$/i,
  box: /^(caption|narration|sfx)(\s*:\s*)(.+)$/i,
  talk: /^([^:\[\]!]{1,40}?)(\s*)(?:(\()(thought|think|thinking|whisper|whispering|shout|shouting|yell)(\)))?(\s*:\s*)(.+)$/i,
  panel: /^(!)?(\s*)(?:(\[)([^\]]*)(\]))?(\s*)(.*)$/,
};
export function wizLine(raw) {
  const line = raw.trim();
  if (!line) return { kind: "blank", toks: raw ? [[raw, ""]] : [] };
  const lead = raw.length - raw.trimStart().length, end = raw.trimEnd().length;
  const L = (kind, toks, more) => ({ kind, ...more, toks: [[raw.slice(0, lead), ""], ...toks, [raw.slice(end), ""]].filter(t => t[0]) });
  if (WIZ_RE.page.test(line)) return L("page", [[line, "brk"]]);
  if (line.startsWith("#")) {                                    // comment / page style
    const k = line.match(WIZ_RE.koma);
    return k ? L("note", [[line.slice(0, k.index), "com"], [k[0], "koma"], [line.slice(k.index + k[0].length), "com"]], { koma: true }) : L("note", [[line, "com"]]);
  }
  let m = line.match(WIZ_RE.title);
  if (m) return L("title", [[m[1], "key"], [m[2], "pun"], [m[3], "title"]], { text: m[3].trim() });
  m = line.match(WIZ_RE.box);
  if (m) { const box = m[1].toLowerCase() === "sfx" ? "sfx" : "caption"; return L("box", [[m[1], "key"], [m[2], "pun"], [m[3], box]], { box, text: m[3].trim() }); }
  m = line.match(WIZ_RE.talk);
  if (m && !/\s{2,}/.test(m[1]) && m[1].split(/\s+/).length <= 4) {
    const who = m[1].trim(), mood = (m[4] || "").toLowerCase(), said = m[7].trim();
    const say = mood.startsWith("th") ? "think" : mood.startsWith("wh") ? "whisper" : (mood.startsWith("sh") || mood === "yell") ? "shout"
      : (/!{2,}$/.test(said) || (said.length > 3 && said === said.toUpperCase() && /[A-Z]/.test(said))) ? "shout" : "say";
    return L("talk", [[m[1], "who"], [m[2], ""], [m[3] || "", "pun"], [m[4] || "", "mood " + say], [m[5] || "", "pun"], [m[6], "pun"], [m[7], say]], { say, who, text: said });
  }
  m = line.match(WIZ_RE.panel);
  const cast = (m[4] || "").split(/(,)/).flatMap(s => { const a = s.length - s.trimStart().length, t = s.trim(); return s === "," ? [[s, "pun"]] : [[s.slice(0, a), ""], [t, "name"], [s.slice(a + t.length), ""]]; });
  return L("panel", [[m[1] || "", "big"], [m[2], ""], [m[3] || "", "pun"], ...cast, [m[5] || "", "pun"], [m[6], ""], [m[7], "desc"]],
    { desc: m[7].trim(), chars: (m[4] || "").split(",").map(s => s.trim()).filter(Boolean), big: !!m[1] });
}

export function parseScript(text, maxPer = 6) {
  const pages = [[]];
  let cur = null;
  const newPanel = (desc, chars, big) => { cur = { desc, chars, big, lines: [] }; pages.at(-1).push(cur); return cur; };
  for (const raw of String(text).split("\n")) {
    const L = wizLine(raw);
    if (L.kind === "blank") continue;
    if (L.kind === "page") { if (pages.at(-1).length) pages.push([]); cur = null; continue; }
    if (L.kind === "note") { if (L.koma) pages.at(-1).koma = true; continue; }
    if (L.kind === "title") { pages.at(-1).title = L.text; continue; }
    if (L.kind === "box") { (cur || newPanel("", [], false)).lines.push({ kind: L.box, text: L.text }); continue; }
    if (L.kind === "talk") {
      const p = cur || newPanel("", [], false);
      if (!p.chars.some(c => c.toLowerCase() === L.who.toLowerCase())) p.chars.push(L.who);
      p.lines.push({ kind: L.say, who: L.who, text: L.text });
      continue;
    }
    newPanel(L.desc, L.chars, L.big);
  }
  const out = [];
  for (const pg of pages.filter(p => p.length)) for (let i = 0; i < pg.length; i += maxPer) {
    const part = pg.slice(i, i + maxPer); part.koma = pg.koma; if (!i) part.title = pg.title; out.push(part);
  }
  return out;
}

/* The same walk as parseScript, kept per line for the editor: which page·panel each panel starts (after
   the automatic split), and the soft warnings mp/wizard.py summarize() gives, pinned to their lines. */
export function wizScan(text, maxPer = 6) {
  const rows = [], panels = [], warns = [];
  let cur = null, base = 0, n = 0;
  const open = (i, desc, chars) => {
    cur = { line: i, page: base + Math.floor(n / maxPer) + 1, no: n % maxPer + 1, desc, chars: [...chars], talk: [] }; n++;
    rows[i].gut = `${cur.page}·${cur.no}`; panels.push(cur); return cur;
  };
  String(text).split("\n").forEach((raw, i) => {
    const L = wizLine(raw); rows.push({ kind: L.kind, toks: L.toks, gut: "", warn: [] });
    if (L.kind === "page") { base += Math.ceil(n / maxPer); n = 0; cur = null; }
    else if (L.kind === "box") cur || open(i, "", []);
    else if (L.kind === "talk") {
      const p = cur || open(i, "", []);
      if (!p.chars.some(c => c.toLowerCase() === L.who.toLowerCase())) p.chars.push(L.who);
      p.talk.push({ line: i, len: [...L.text].length });
    } else if (L.kind === "panel") open(i, L.desc, L.chars);
  });
  const mark = (i, msg, pick) => { rows[i].warn.push(msg); let ts = rows[i].toks.filter(t => t[1] && pick(t[1])); if (!ts.length) ts = rows[i].toks.filter(t => t[0].trim()); ts.forEach(t => (t[2] = true)); };
  for (const p of panels) {
    const add = (i, msg, pick) => { mark(i, msg, pick); warns.push({ line: i, page: p.page, panel: p.no, msg: `page ${p.page} panel ${p.no}: ${msg}` }); };
    if (!p.desc && !p.chars.length) add(p.line, "no description and nobody in it (the render has nothing to draw)", () => true);
    if (p.chars.length > 3) add(p.line, `${p.chars.length} characters; renders get unreliable past 3`, c => c === "name");
    if (p.talk.length > 3) {
      const msg = `${p.talk.length} lines of dialogue; more than 3 crowds a panel, split it`;
      add(p.talk[3].line, msg, c => c === "who"); p.talk.slice(4).forEach(t => mark(t.line, msg, c => c === "who"));
    }
    for (const t of p.talk) if (t.len > 120) add(t.line, `a line of ${t.len} characters; keep bubbles under ~100`, c => ["say", "think", "shout", "whisper"].includes(c));
  }
  return { rows, warns, panels: panels.length, pages: base + Math.ceil(n / maxPer) };
}

/* rows of relative widths + heights for n panels; big panels get a row of their own */
export function wizRows(panels) {
  const rows = [], hs = [];
  let i = 0;
  const n = panels.length;
  if (panels.koma) return [panels.map(() => [1]), panels.map(() => 1)];   // 4-koma: equal stacked strips
  while (i < n) {
    const p = panels[i];
    if (p.big || n <= 3) { rows.push([1]); hs.push(p.big ? 1.7 : 1); i++; continue; }
    const left = n - i, next = panels[i + 1];
    if (left === 1 || next?.big) { rows.push([1]); hs.push(1); i++; continue; }
    const three = left >= 7 && !panels[i + 2]?.big;          // dense pages: three across
    rows.push(three ? [1, 1, 1] : [1.15, 1]); hs.push(1); i += three ? 3 : 2;
  }
  return [rows, hs];
}

export const WIZ_SHAPE = { say: "oval", think: "cloud", shout: "burst", whisper: "whisper" };
export function wizBubbles(panel, p, rtl) {
  const out = [], talk = p.lines.filter(l => !["caption", "sfx"].includes(l.kind));
  const pad = Math.max(24, panel.w * 0.03), maxW = Math.max(220, panel.w * 0.46);
  let prev = null;
  for (const ln of talk) {
    const len = ln.text.length;
    const bw = clamp(150 + Math.sqrt(len) * 40, 220, maxW);
    const bh = clamp(bw * (0.5 + Math.min(len, 160) / 400), 130, panel.h * 0.4);
    // manga flow: start in the reading-start corner; the next bubble steps toward the reading end and a
    // little lower; when there is no room beside, it goes below the previous one. Never overlapping.
    let x, y;
    const start = rtl ? panel.x + panel.w - pad - bw : panel.x + pad;
    if (!prev) { x = start; y = panel.y + pad; }
    else {
      const beside = rtl ? prev.x - 12 - bw : prev.x + prev.w + 12;
      if (rtl ? beside >= panel.x + pad : beside + bw <= panel.x + panel.w - pad) { x = beside; y = prev.y + prev.h * 0.35; }
      else { x = start; y = prev.y + prev.h + 10; }
    }
    x = clamp(x, panel.x + 4, panel.x + panel.w - bw - 4); y = clamp(y, panel.y + 4, panel.y + panel.h - bh - 4);
    prev = { x, y, w: bw, h: bh };
    // tail toward where the speaker stands (characters are listed left to right in the frame)
    const who = p.chars.findIndex(c => c.toLowerCase() === (ln.who || "").toLowerCase());
    const tx = panel.x + panel.w * (who < 0 ? 0.5 : (who + 1) / (p.chars.length + 1)), ty = panel.y + panel.h * 0.62;
    let dx = tx - (x + bw / 2), dy = ty - (y + bh / 2);
    const f = 1.45 / Math.max(0.01, Math.hypot(dx / (bw / 2), dy / (bh / 2)));
    dx *= f; dy *= f;
    const shape = WIZ_SHAPE[ln.kind];
    out.push({ type: "vbubble", shape, x, y, w: bw, h: bh, text: ln.text, seed: Math.floor(Math.random() * 1e6),
      tail: shape === "burst" && !ln.who ? null : { x: dx, y: Math.max(dy, bh * 0.3) },
      font: shape === "burst" ? "Bangers" : "MMComic", bold: shape === "burst" });
  }
  p.lines.filter(l => l.kind === "caption").forEach((ln, k) => {
    const w = Math.min(panel.w * 0.5, 560), hh = clamp(70 + ln.text.length * 1.2, 90, 200);
    out.push({ type: "caption", x: rtl ? panel.x + 10 : panel.x + panel.w - w - 10, y: panel.y + 10 + k * (hh + 10), w, h: hh, text: ln.text, fill: "#ffffff" });
  });
  p.lines.filter(l => l.kind === "sfx").forEach((ln, k) => {
    const w = Math.min(panel.w * 0.55, 620), hh = Math.min(panel.h * 0.3, 240);
    out.push({ type: "text", sfx: true, x: panel.x + panel.w * (rtl ? 0.08 : 0.37) + k * 40, y: panel.y + panel.h * 0.55 - k * 40, w, h: hh, text: ln.text,
      rotate: k % 2 ? 8 : -8, color: "#ffffff", stroke: "#000000", strokeWidth: 12, font: "Bangers", fontSize: 0 });
  });
  return out;
}

export async function buildFromScript(pages, opt) {
  const rtl = opt.reading === "rtl";
  if (opt.mode === "new") { loadDoc(normalize({ ...newDoc(opt.title || "Chapter"), reading: opt.reading }), ""); S.doc.pages = []; }
  S.doc.reading = opt.reading;
  const shots = [];
  let pgNo = S.doc.pages.length;
  for (const pg of pages) {
    pgNo++;
    const [rows, hs] = wizRows(pg);
    const ordered = rows.map(r => rtl ? [...r].reverse() : r);
    const rects = gridRects(ordered, hs);
    const fresh = normalize({ pages: [{ layers: rects.map(([x, y, w, hh]) => ({ type: "panel", x, y, w, h: hh, shot: "", image: null })) }] }).pages[0].layers;
    const order = panelOrder(fresh);                   // reading order, same rule as the pipeline
    const lettering = [];
    order.forEach((panel, i) => {
      const p = pg[i]; if (!p) return;
      if (opt.shots && (p.desc || p.chars.length)) {
        panel.shot = `${opt.prefix}_p${String(pgNo).padStart(2, "0")}_${i + 1}`;
        const chars = p.chars.map(n => ({ name: n, series: opt.series || "" }));
        shots.push({ name: panel.shot, prompt: p.desc, characters: typeof enrichChars === "function" ? enrichChars(chars) : chars });
      }
      lettering.push(...wizBubbles(panel, p, rtl));
    });
    if (pg.title) lettering.unshift({ type: "text", x: W() * 0.1, y: H() * 0.05, w: W() * 0.8, h: H() * 0.14, text: pg.title, font: "Anton",
      color: "#ffffff", stroke: "#000000", strokeWidth: 14, fontSize: 0, bold: false });
    S.doc.pages.push(normalize({ pages: [{ id: uid(), bg: "#ffffff", layers: [...fresh, ...lettering] }] }).pages[0]);
  }
  let made = 0;
  for (const s of shots) { try { await post("/api/shot/new", { ...s, keep: true }); made++; } catch (e) { console.warn(s.name, e.message); } }
  if (shots.length) await loadShots();
  S.page = opt.mode === "new" ? 0 : S.doc.pages.length - pages.length; S.sel = null;
  commit(`Built ${pages.length} page${pages.length > 1 ? "s" : ""} from a script`);
  refreshPanels(); renderPages(); fitView(); requestDraw();
  toast(`${pages.length} page${pages.length > 1 ? "s" : ""}, ${pages.reduce((a, p) => a + p.length, 0)} panels` + (shots.length ? `, ${made} shots ready to pose` : ""), "ok");
}
