/* Script to pages: a scene written as plain lines becomes pages of panels with bubbles already placed
   in reading order, and (optionally) one shot per panel with its characters and prompt, ready to pose
   and render. Loaded after app.js and uses its helpers.

   Format (one thing per line):
     ---                         new page (pages are also split automatically)
     [Rem, Ram] Classroom...     a new panel; [..] = who is in it, left to right; the rest is the prompt
     ! Rem slams the door        "!" makes it a big panel
     Rem: Good morning!          speech        Rem (thought): ...   thought   Rem (shout): ...   shout
     Ram (whisper): psst         whisper       Caption: The next day.        SFX: BAM            */

const WIZ_EXAMPLE = `[Rem] Classroom after school, sunset through the windows. Rem waits by the door.
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
const WIZ_RE = {
  page: /^(-{3,}|#\s*page\b.*|page\s*\d*\s*:?)$/i,
  koma: /4[\s-]?koma|yonkoma/i,
  title: /^(title)(\s*:\s*)(.+)$/i,
  box: /^(caption|narration|sfx)(\s*:\s*)(.+)$/i,
  talk: /^([^:\[\]!]{1,40}?)(\s*)(?:(\()(thought|think|thinking|whisper|whispering|shout|shouting|yell)(\)))?(\s*:\s*)(.+)$/i,
  panel: /^(!)?(\s*)(?:(\[)([^\]]*)(\]))?(\s*)(.*)$/,
};
function wizLine(raw) {
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

function parseScript(text, maxPer = 6) {
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
function wizScan(text, maxPer = 6) {
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
function wizRows(panels) {
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

const WIZ_SHAPE = { say: "oval", think: "cloud", shout: "burst", whisper: "whisper" };
function wizBubbles(panel, p, rtl) {
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

async function buildFromScript(pages, opt) {
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
    if (S.doc.theme === "dark" && typeof setPageTheme === "function") setPageTheme(S.doc.pages.at(-1), "dark");   // the book's theme
  }
  let made = 0;
  for (const s of shots) { try { await post("/api/shot/new", { ...s, keep: true }); made++; } catch (e) { console.warn(s.name, e.message); } }
  if (shots.length) await loadShots();
  S.page = opt.mode === "new" ? 0 : S.doc.pages.length - pages.length; S.sel = null;
  commit(`Built ${pages.length} page${pages.length > 1 ? "s" : ""} from a script`);
  refreshPanels(); renderPages(); fitView(); requestDraw();
  toast(`${pages.length} page${pages.length > 1 ? "s" : ""}, ${pages.reduce((a, p) => a + p.length, 0)} panels` + (shots.length ? `, ${made} shots ready to pose` : ""), "ok");
}

/* ================================================================ script editor (highlighted textarea) */
/* The textarea stays the real editor (native undo, IME, selection); its text is transparent and a layer
   with the same metrics sits under it, one block per line. Only colour, background and underline differ
   between tokens: anything that changed a glyph's width would let the two drift apart. */
function wizPaint(host, rows) {
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
function wizUnfence(text) {
  const t = String(text).replace(/\r\n?/g, "\n");
  const m = [...t.matchAll(/^[ \t]*(```+|~~~+)[^\n`]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm)];
  if (m.length) return m.map(x => x[2]).join("\n");
  const cut = t.match(/^(?:[\s\S]*?\n)?[ \t]*(?:```+|~~~+)[^\n`]*\n([\s\S]*)$/);
  return cut && cut[1].trim() ? cut[1] : text;
}

function wizEditor(per, onScan) {
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

/* ================================================================ prompt for converting a script with any LLM */
/* The whole prompt lives here (docs/SCRIPT_WIZARD.md carries the same text with default options). It has no
   fence lines of its own: the guide dialog shows that file and its Markdown subset cannot nest code blocks.
   opts: source, reading "rtl"|"ltr", perPage, names (array or comma list), language, tone. */
function llmScriptPrompt(opts = {}) {
  const per = Math.max(1, Math.min(9, Math.round(+opts.perPage) || 6)), aim = per >= 6 ? "4 to 6" : per >= 4 ? `4 to ${per}` : `up to ${per}`;
  const names = (Array.isArray(opts.names) ? opts.names : String(opts.names || "").split(/[,\n]/)).map(s => String(s).trim()).filter(Boolean);
  const lang = String(opts.language || "").trim(), tone = String(opts.tone || "").trim(), src = String(opts.source || "").trim();
  return `You are a manga script adapter. Convert the SOURCE at the end of this message into a manga script in the exact plain-text format described below. The source may be a story, an outline, a prose chapter, a screenplay, or a comic script written in some other format. A program reads your output line by line and turns it into pages, panels, lettered speech bubbles and one picture prompt per panel for an image generator, so the syntax has to be exact.

# FORMAT

One item per line. Blank lines are ignored. These are the only line types:

[Name, Name] picture prompt
    PANEL. Starts a new panel. The square brackets list every character visible in it, separated by commas, in left-to-right order as they stand in the frame. Everything after "]" is the picture prompt of that panel. A panel with nobody in it (scenery, an object) has empty brackets: [] picture prompt
! [Name, Name] picture prompt
    BIG PANEL. A panel line with "!" in front gets a full-width, taller row.
Name: text
    SPEECH (oval bubble) said by Name.
Name (thought): text
    THOUGHT (cloud bubble).
Name (shout): text
    SHOUT (spiky bubble).
Name (whisper): text
    WHISPER (dashed bubble).
Caption: text
    CAPTION. A narration box in the corner of the panel: time, place, short narration.
SFX: TEXT
    SOUND EFFECT lettered across the panel. Short and in capitals: BAM, TAP TAP, DOKI DOKI.
Title: TEXT
    TITLE. A big title on the page it is written in (chapter openers and covers only).
---
    PAGE BREAK. Three hyphens alone on a line; the next panel starts a new page.
# 4-koma
    FOUR-PANEL STRIP. Alone on a line at the top of a page: that page becomes four equal panels stacked top to bottom. Write exactly four panels for it.
# any other text
    NOTE. Ignored by the program. Do not write notes unless the source asks for them.

# PARSING RULES

- Speech, thought, shout, whisper, Caption and SFX lines belong to the panel line above them. Write the panel line first, then its lines in the order they are read.
- Start every panel line with "[" (or "! [" for a big panel). A line that starts with a few words and a colon is read as dialogue, never as a panel.
- A name is 1 to 4 words, at most 40 characters, without colons, square brackets or exclamation marks. Spell each character's name identically every time, in the brackets and in dialogue (always "Rem", never "Rem" in one place and "Rem-chan" in another). The name before the colon is a label and is not printed in the bubble.
- The only moods are (thought), (shout) and (whisper), written between the name and the colon. Put nothing else in parentheses there: acting directions such as (smiling) or (to Ken) belong in the picture prompt.
- The order of the names in the brackets is their left-to-right order in the picture. Bubble tails and the image generator both rely on it.
- A speaker who is missing from the panel's brackets is added at the right end and drawn, so list every speaker yourself, in the right position. For a voice from outside the frame, use a Caption or give the speaker a panel.
- Speech that ends in "!!" or is written entirely in CAPITALS becomes a shout by itself. Only write speech that way when it is shouted.
- "---" starts a new page. Aim for ${aim} panels per page. A page with more than ${per} panels is split after every ${per} panels, wherever that falls, so place every page break yourself.
- "# 4-koma" and "Title:" apply to the page they are written in; put them right after the "---" that opens the page.
- Every item stays on one line: never wrap a bubble or a picture prompt over several lines.
- Write no "Page 1", "Panel 2", scene headings, numbering, speaker lists or stage directions on lines of their own. Any line that is not one of the types above becomes an unwanted panel.

# PICTURE PROMPTS

The picture prompt describes one frozen image, not the story. It goes to an anime image generator.
- Say where and when (place, time of day, lighting), what each listed character is doing (pose, action), their expression, and the camera (close-up, upper body, full body, wide shot, from above, from below, from behind, dynamic angle).
- Write it in English as short comma-separated phrases. Danbooru-style tags work best: classroom, sunset, sitting at desk, smiling, looking at viewer, from below.
- No dialogue, no quoted words, no sound effects, no thoughts, no backstory, nothing that happens before or after this instant.
- Names may be used to say who does what. Fixed looks (hair, eyes, usual outfit) are not needed; mention clothing or props only when they matter in this panel.
- Show the place in the first panel of each scene, then change the camera from panel to panel.

# PACING

- One beat per panel: one moment, one action.
- ${aim[0].toUpperCase() + aim.slice(1)} panels per page, with at most one big panel ("!") for the moment the page builds to, usually last or in the middle. End each page on a hook so the reader turns it.
- In long conversations alternate between the speakers' faces and add reaction panels; a panel with no dialogue at all is fine.
- Captions carry time and place. SFX carry sound.
- The pages are read ${opts.reading === "ltr" ? "left to right" : "right to left (manga)"}. This changes nothing in how you write: panels in story order, names in left-to-right frame order.

# HARD LIMITS

- At most 3 characters in a panel. For a crowd, list who matters and put "crowd in the background" in the picture prompt.
- At most 3 dialogue lines (speech, thought, shout, whisper) in a panel. More than that: start another panel.
- Every bubble under about 100 characters. Split longer speeches at sentence ends into several lines by the same speaker, or across panels.
- Keep the source's dialogue wording. Change it only where a long speech has to be split; do not paraphrase, add or drop lines. Narration that matters becomes short Caption lines; description becomes picture prompts.
- Keep the source's order of events. Do not invent events or characters.
- All characters are adults (18 or older) and are written and described as adults.

# SETTINGS FOR THIS CONVERSION

- Character names: ${names.length ? `use exactly these spellings where these characters appear: ${names.join(", ")}. Other characters keep the name the source gives them.` : "take them from the source; give unnamed speakers a short fixed label (Teacher, Guard)."}
- Language of dialogue, captions and titles: ${lang || "the language of the source; do not translate"}. Picture prompts are always in English.
- Panels per page: ${aim}, never more than ${per}.${tone ? `\n- Content rating and tone: ${tone}.` : ""}

# OUTPUT

Reply with the script only, inside one code block (a line of three backticks before it and after it). No introduction, no explanation, no closing remarks. Inside the block use plain lines only: no markdown, no bold, no bullets, no numbering, no indentation. If the source is too long for one reply, convert as much as fits, stop at a page break, and continue from there when you are told "continue".

# EXAMPLE

Source:
It was almost midnight when Mika got home. Her brother Ken was waiting in the kitchen with his arms crossed. "Do you know what time it is?" he asked. She wanted to say she was sorry. "I lost track," she said. Then every light in the house went out with a bang.

Answer (the lines inside the code block):
[] Suburban house at night, exterior, one lit kitchen window, wide shot.
Caption: Almost midnight.
[Mika] Entrance hall, dim light, Mika taking off her shoes quietly, nervous, from behind.
[Ken, Mika] Kitchen at night, Ken standing with arms crossed, stern, Mika in the doorway, looking away, medium shot.
Ken: Do you know what time it is?
[Mika] Close-up of Mika, guilty expression, sweat drop.
Mika (thought): I'm sorry.
Mika: I lost track.
! [Ken, Mika] Dark kitchen, lights going out, Ken and Mika startled, silhouettes, dramatic lighting, from above.
SFX: BANG

# SOURCE

${src ? `Convert everything between the two marker lines.\n\n===== SOURCE BEGINS =====\n${src}\n===== SOURCE ENDS =====` : "PASTE YOUR SCRIPT BELOW THIS LINE\n"}`;
}

async function wizCopy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { }
  const t = h("textarea", { readOnly: true, style: "position:fixed;left:-9999px;top:0" }); t.value = text; document.body.append(t); t.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch { }
  t.remove(); return ok;
}

/* Sits above the wizard instead of replacing it (modal() has one slot), so the script stays as it is. */
function llmPromptDialog(ed, defaults) {
  $("#wizllm")?.remove();
  const known = () => (typeof CAST !== "undefined" && CAST.list || []).map(c => c.name).filter(Boolean).join(", ");
  let saved = {}; try { saved = JSON.parse(localStorage.getItem("mm.llm") || "{}") || {}; } catch { }
  const src = h("textarea", { rows: 7, spellcheck: "false", placeholder: "Optional: paste the story, chapter or script to convert.\nLeave this empty to paste it after the prompt, in the chat." });
  const dir = h("select", {}, h("option", { value: "rtl" }, "Right to left (manga)"), h("option", { value: "ltr" }, "Left to right")); dir.value = defaults.reading;
  const pp = h("input", { type: "number", value: defaults.perPage, min: 1, max: 9, style: "width:56px" });
  const names = h("input", { value: known(), placeholder: "Rem, Subaru (spellings to keep)" });
  const lang = h("input", { value: saved.language || "", placeholder: "same as the source" });
  const tone = h("input", { value: saved.tone || "", placeholder: "e.g. all-ages comedy, dark fantasy" });
  const count = h("span", { class: "hint wizcount" });
  const manual = h("textarea", { rows: 4, readOnly: true, hidden: true, spellcheck: "false", "aria-label": "Prompt" });   // shown only when the clipboard refuses
  const text = () => llmScriptPrompt({ source: src.value, reading: dir.value, perPage: pp.value, names: names.value, language: lang.value, tone: tone.value });
  const tick = () => { count.textContent = `${text().length.toLocaleString()} characters` + (src.value.trim() ? ", script included" : ", script goes after it"); };
  const onKey = e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };   // before the editor's own Escape, which would close the wizard under us
  const close = () => { document.removeEventListener("keydown", onKey, true); wrap.remove(); };
  const copy = async () => {
    try { localStorage.setItem("mm.llm", JSON.stringify({ language: lang.value.trim(), tone: tone.value.trim() })); } catch { }
    const t = text();
    if (await wizCopy(t)) toast(`Prompt copied (${t.length.toLocaleString()} characters). Paste it into any LLM chat` + (src.value.trim() ? "" : ", then your script under it"), "ok");
    else { manual.hidden = false; manual.value = t; manual.focus(); manual.select(); toast("The clipboard is blocked here: the prompt is selected below, copy it with ⌘C / Ctrl+C", "err"); }
  };
  const paste = async () => {
    let t = ""; try { t = await navigator.clipboard.readText(); } catch { return toast("The clipboard cannot be read here: close this and paste into the editor, code fences are removed for you", "err"); }
    t = wizUnfence(t).trim();
    if (!parseScript(t).length) return toast("The clipboard has no script in it", "err");
    const now = ed.ta.value.trim(), keep = now && now !== WIZ_EXAMPLE && !(typeof STARTERS !== "undefined" && STARTERS.some(s => s[2] === now));
    if (keep && !confirm("Replace the script in the editor with the one on the clipboard?")) return;
    close(); ed.set(t); toast("Script pasted. Check the preview, then Build pages", "ok");
  };
  const wrap = h("div", { id: "wizllm", onpointerdown: e => { if (e.target === wrap) close(); } }, h("div", { class: "wizllmbox", role: "dialog", "aria-label": "Copy LLM prompt" },
    h("div", { class: "mhead" }, "Convert a script with any LLM", h("button", { class: "ghost", onclick: close }, "✕")),
    h("div", { class: "mbody" },
      h("p", { class: "hint", style: "margin-top:0" }, "Copies a prompt that teaches any chat model this script format. Paste it into the chat, send, then paste the answer into the Script Wizard."),
      src,
      h("div", { class: "form" }, rowOf("Reading", dir), rowOf("Panels / page", pp), rowOf("Characters", names), rowOf("Language", lang), rowOf("Rating / tone", tone)), manual),
    h("div", { class: "mfoot" }, count, h("div", { class: "spacer" }),
      h("button", { onclick: paste, title: "Put the model's answer from the clipboard into the editor (code fences are removed)" }, "Paste result"),
      h("button", { onclick: close }, "Close"),
      h("button", { class: "primary", onclick: copy }, "Copy prompt"))));
  [src, pp, names, lang, tone].forEach(e => e.addEventListener("input", tick)); dir.addEventListener("change", tick);
  document.addEventListener("keydown", onKey, true);
  document.body.append(wrap); tick(); setTimeout(() => src.focus(), 0);
  if (!names.value && typeof CAST !== "undefined" && !CAST.list && typeof loadCast === "function") loadCast().then(() => { if (!names.value) { names.value = known(); tick(); } });
}

const WIZ_LEGEND = [["big", "!"], ["pun", "["], ["name", "Name"], ["pun", "]"], ["desc", " picture prompt"], ["", "   "], ["who", "Name"], ["pun", ": "], ["say", "speech"], ["", "  "], ["think", "thought"], ["", "  "],
  ["shout", "shout"], ["", "  "], ["whisper", "whisper"], ["", "   "], ["key", "Caption"], ["pun", ": "], ["caption", "text"], ["", "   "], ["key", "SFX"], ["pun", ": "], ["sfx", "BAM"], ["", "   "],
  ["key", "Title"], ["pun", ": "], ["title", "TEXT"], ["", "   "], ["brk", "---"], ["", " page   "], ["koma", "# 4-koma"], ["", "  "], ["com", "# note"]];

function scriptWizard(focus) {
  const box = modal("Script Wizard: pages from a script", "");
  const mode = h("select", {}, h("option", { value: "new" }, "Replace the project"), h("option", { value: "append" }, "Add after the last page"));
  const reading = h("select", {}, h("option", { value: "rtl" }, "Right to left (manga)"), h("option", { value: "ltr" }, "Left to right"));
  reading.value = S.doc.reading || "rtl";
  const prefix = h("input", { value: "ch1", style: "width:90px" }), series = h("input", { placeholder: "Re:Zero", style: "width:140px" });
  const per = h("input", { type: "number", value: 6, min: 1, max: 9, style: "width:56px" });
  const perPage = () => Math.max(1, Math.round(+per.value) || 6);
  const mkShots = h("input", { type: "checkbox", checked: true });
  const prev = h("div", { class: "wizprev" });
  const update = () => {
    const pages = parseScript(ta.value, perPage()); prev.innerHTML = "";
    if (!pages.length) { prev.append(h("div", { class: "hint" }, "Nothing to build yet.")); return pages; }
    pages.forEach((pg, i) => {
      const [rows, hs] = wizRows(pg);
      const c = presetThumb(rows.map(r => reading.value === "rtl" ? [...r].reverse() : r), hs); c.style.width = "54px";
      prev.append(h("div", { class: "wizpage" }, c, h("div", {}, h("b", {}, `Page ${i + 1}`), ` · ${pg.length} panel${pg.length > 1 ? "s" : ""}`,
        ...pg.map((p, k) => h("div", { class: "hint", style: "margin:2px 0" }, `${k + 1}. ${p.chars.length ? "[" + p.chars.join(", ") + "] " : ""}${p.desc || "(no description)"}` +
          (p.lines.length ? ` — ${p.lines.length} line${p.lines.length > 1 ? "s" : ""}` : ""))))));
    });
    return pages;
  };
  const save = () => { try { localStorage.setItem("mm.script", ta.value); } catch { } };
  const ed = wizEditor(perPage, () => { update(); save(); }), ta = ed.ta;
  ta.addEventListener("input", save);                      // at once: the repaint waits for a frame, which a hidden tab never gets
  try { ta.value = localStorage.getItem("mm.script") || WIZ_EXAMPLE; } catch { ta.value = WIZ_EXAMPLE; }
  const starters = typeof STARTERS !== "undefined" ? STARTERS : [];
  const tpl = h("select", { onchange: e => { const st = starters[+e.target.value]; if (st && e.target.value !== "" && (!ta.value.trim() || ta.value === WIZ_EXAMPLE || starters.some(x => x[2] === ta.value) || confirm("Replace the script with this template?"))) ed.set(st[2]); } },
    h("option", { value: "" }, "— pick a starter —"), ...starters.map((st, i) => h("option", { value: i, title: st[1] }, st[0])));
  [per, reading].forEach(e => e.addEventListener("change", ed.refresh));
  $(".mbody", box).append(h("div", { class: "wizard" },
    h("div", {}, ed.el, ed.list,
      h("div", { class: "wizlegend", "aria-hidden": "true" }, ...WIZ_LEGEND.map(([c, t]) => c ? h("span", { class: "wz-" + c }, t) : t)),
      h("p", { class: "hint" },
        "One thing per line. A plain line starts a panel; [Name, Name] lists who is in it (left to right), the rest becomes the render prompt. ",
        "\"!\" first = big panel. Dialogue: Name: text, or Name (thought / shout / whisper): text. Caption: …, SFX: … and Title: … too. --- starts a new page; a # line is a note (# 4-koma stacks the page in four strips). ",
        "The margin shows page·panel where each panel starts; underlined parts are listed under the editor.")),
    h("div", {}, h("div", { class: "form" }, rowOf("Template", tpl), rowOf("Pages", mode), rowOf("Reading", reading), rowOf("Panels / page", per),
      rowOf("Shots", h("label", { class: "hint", style: "display:flex;gap:6px;align-items:center;margin:0" }, mkShots, "one per panel, named"), prefix),
      rowOf("Series", series)), h("div", { class: "section" }, "Preview"), prev)));
  box.append(h("div", { class: "mfoot" }, h("button", { onclick: () => ed.set(WIZ_EXAMPLE) }, "Example"),
    h("button", { onclick: () => typeof wizardGuide === "function" && wizardGuide(), title: "How to write a script, with examples" }, "Guide"),
    h("button", { onclick: () => llmPromptDialog(ed, { reading: reading.value, perPage: perPage() }), title: "Copy a prompt that makes any LLM turn a story or another script format into this format" }, "Copy LLM prompt"),
    h("div", { class: "spacer" }),
    h("button", { onclick: closeModal }, "Cancel"),
    h("button", { class: "primary", onclick: async () => {
      const pages = update(); if (!pages.length) return toast("Write at least one panel", "err");
      if (mode.value === "new" && S.dirty && !confirm("Replace the current project? Unsaved changes are lost.")) return;
      closeModal();
      await buildFromScript(pages, { mode: mode.value, reading: reading.value, prefix: (prefix.value.trim() || "ch1").replace(/[^\w\-.]/g, "_"), series: series.value.trim(), shots: mkShots.checked });
    } }, "Build pages")));
  update(); ed.refresh(); setTimeout(() => (focus === "starter" ? tpl : ta).focus(), 0);
}
