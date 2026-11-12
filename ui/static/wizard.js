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

function parseScript(text, maxPer = 6) {
  const pages = [[]];
  let cur = null;
  const newPanel = (desc, chars, big) => { cur = { desc, chars, big, lines: [] }; pages.at(-1).push(cur); return cur; };
  for (let raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(-{3,}|#\s*page\b.*|page\s*\d*\s*:?)$/i.test(line)) { if (pages.at(-1).length) pages.push([]); cur = null; continue; }
    if (line.startsWith("#")) { if (/4[\s-]?koma|yonkoma/i.test(line)) pages.at(-1).koma = true; continue; }   // comment / page style
    let t = line.match(/^title\s*:\s*(.+)$/i);
    if (t) { pages.at(-1).title = t[1].trim(); continue; }
    let m = line.match(/^(caption|narration|sfx)\s*:\s*(.+)$/i);
    if (m) { (cur || newPanel("", [], false)).lines.push({ kind: /sfx/i.test(m[1]) ? "sfx" : "caption", text: m[2].trim() }); continue; }
    m = line.match(/^([^:\[\]!]{1,40}?)\s*(?:\((thought|think|thinking|whisper|whispering|shout|shouting|yell)\))?\s*:\s*(.+)$/i);
    if (m && !/\s{2,}/.test(m[1]) && m[1].split(/\s+/).length <= 4) {
      const who = m[1].trim(), mood = (m[2] || "").toLowerCase(), said = m[3].trim();
      const kind = mood.startsWith("th") ? "think" : mood.startsWith("wh") ? "whisper" : (mood.startsWith("sh") || mood === "yell") ? "shout"
        : (/!{2,}$/.test(said) || (said.length > 3 && said === said.toUpperCase() && /[A-Z]/.test(said))) ? "shout" : "say";
      const p = cur || newPanel("", [], false);
      if (!p.chars.some(c => c.toLowerCase() === who.toLowerCase())) p.chars.push(who);
      p.lines.push({ kind, who, text: said });
      continue;
    }
    m = line.match(/^(!)?\s*(?:\[([^\]]*)\])?\s*(.*)$/);
    newPanel(m[3].trim(), (m[2] || "").split(",").map(s => s.trim()).filter(Boolean), !!m[1]);
  }
  const out = [];
  for (const pg of pages.filter(p => p.length)) for (let i = 0; i < pg.length; i += maxPer) {
    const part = pg.slice(i, i + maxPer); part.koma = pg.koma; if (!i) part.title = pg.title; out.push(part);
  }
  return out;
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
  }
  let made = 0;
  for (const s of shots) { try { await post("/api/shot/new", { ...s, keep: true }); made++; } catch (e) { console.warn(s.name, e.message); } }
  if (shots.length) await loadShots();
  S.page = opt.mode === "new" ? 0 : S.doc.pages.length - pages.length; S.sel = null;
  commit(`Built ${pages.length} page${pages.length > 1 ? "s" : ""} from a script`);
  refreshPanels(); renderPages(); fitView(); requestDraw();
  toast(`${pages.length} page${pages.length > 1 ? "s" : ""}, ${pages.reduce((a, p) => a + p.length, 0)} panels` + (shots.length ? `, ${made} shots ready to pose` : ""), "ok");
}

function scriptWizard(focus) {
  const box = modal("Script Wizard: pages from a script", "");
  const ta = h("textarea", { rows: 16, spellcheck: false, style: "width:100%;font:13px/1.5 ui-monospace,Menlo,monospace" });
  try { ta.value = localStorage.getItem("mm.script") || WIZ_EXAMPLE; } catch { ta.value = WIZ_EXAMPLE; }
  const mode = h("select", {}, h("option", { value: "new" }, "Replace the project"), h("option", { value: "append" }, "Add after the last page"));
  const reading = h("select", {}, h("option", { value: "rtl" }, "Right to left (manga)"), h("option", { value: "ltr" }, "Left to right"));
  reading.value = S.doc.reading || "rtl";
  const prefix = h("input", { value: "ch1", style: "width:90px" }), series = h("input", { placeholder: "Re:Zero", style: "width:140px" });
  const per = h("input", { type: "number", value: 6, min: 1, max: 9, style: "width:56px" });
  const mkShots = h("input", { type: "checkbox", checked: true });
  const prev = h("div", { class: "wizprev" });
  const starters = typeof STARTERS !== "undefined" ? STARTERS : [];
  const tpl = h("select", { onchange: e => { const st = starters[+e.target.value]; if (st && (!ta.value.trim() || ta.value === WIZ_EXAMPLE || starters.some(x => x[2] === ta.value) || confirm("Replace the script with this template?"))) { ta.value = st[2]; update(); } } },
    h("option", { value: "" }, "— pick a starter —"), ...starters.map((st, i) => h("option", { value: i, title: st[1] }, st[0])));
  const update = () => {
    const pages = parseScript(ta.value, +per.value || 6); prev.innerHTML = "";
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
  ta.addEventListener("input", () => { update(); try { localStorage.setItem("mm.script", ta.value); } catch { } });
  [per, reading].forEach(e => e.addEventListener("change", update));
  $(".mbody", box).append(h("div", { class: "wizard" },
    h("div", {}, ta, h("p", { class: "hint" },
      "One thing per line. A plain line starts a panel; [Name, Name] lists who is in it (left to right), the rest becomes the render prompt. ",
      "\"!\" first = big panel. Dialogue: Name: text, or Name (thought / shout / whisper): text. Caption: …, SFX: … and Title: … too. --- starts a new page; a # line is a note (# 4-koma stacks the page in four strips).")),
    h("div", {}, h("div", { class: "form" }, rowOf("Template", tpl), rowOf("Pages", mode), rowOf("Reading", reading), rowOf("Panels / page", per),
      rowOf("Shots", h("label", { class: "hint", style: "display:flex;gap:6px;align-items:center;margin:0" }, mkShots, "one per panel, named"), prefix),
      rowOf("Series", series)), h("div", { class: "section" }, "Preview"), prev)));
  box.append(h("div", { class: "mfoot" }, h("button", { onclick: () => { ta.value = WIZ_EXAMPLE; update(); } }, "Example"),
    h("button", { onclick: () => typeof wizardGuide === "function" && wizardGuide(), title: "How to write a script, with examples" }, "Guide"), h("div", { class: "spacer" }),
    h("button", { onclick: closeModal }, "Cancel"),
    h("button", { class: "primary", onclick: async () => {
      const pages = update(); if (!pages.length) return toast("Write at least one panel", "err");
      if (mode.value === "new" && S.dirty && !confirm("Replace the current project? Unsaved changes are lost.")) return;
      closeModal();
      await buildFromScript(pages, { mode: mode.value, reading: reading.value, prefix: (prefix.value.trim() || "ch1").replace(/[^\w\-.]/g, "_"), series: series.value.trim(), shots: mkShots.checked });
    } }, "Build pages")));
  update(); setTimeout(() => (focus === "starter" ? tpl : ta).focus(), 0);
}
