/* Beginner helpers: page checker, starter templates, character sheet (cast), "make it manga" and tips.
   Loaded after app.js, pose.js and wizard.js; uses their helpers. */

/* ================================================================ page checker */
const TEXT_TYPES = ["bubble", "vbubble", "caption", "text"];
const PRINT_MIN_PX = 28;          // ~8 pt on a B5 page at 1800 px wide: smaller is hard to read in print
function safeRect() { const mm = W() / 182, s = 8 * mm; return { x: s, y: s, w: W() - 2 * s, h: H() - 2 * s }; }
const boxOf = l => ({ x: l.x, y: l.y, w: l.w, h: l.h });
const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const centreIn = (l, p) => { const cx = l.x + l.w / 2, cy = l.y + l.h / 2; return cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h; };
function textBox(l) {                    // the box text is fitted into, as drawLayer does it
  if (l.type === "vbubble") { const k = VTEXT[l.shape] || [0.7, 0.64]; return [l.w * k[0], l.h * k[1]]; }
  if (l.type === "bubble") { const m = bubbleMeta(l.bubble); return m ? [l.w * (m.box[2] - m.box[0]) * 0.92, l.h * (m.box[3] - m.box[1]) * 0.92] : [l.w * 0.7, l.h * 0.6]; }
  return [l.w * 0.9, l.h * 0.86];
}
/* manga reading order for lettering inside a panel: top to bottom in bands, right to left (rtl) */
function letterOrder(ls) {
  const rtl = S.doc.reading !== "ltr";
  return [...ls].sort((a, b) => {
    const band = Math.min(a.h, b.h) * 0.5;
    if (Math.abs(a.y - b.y) > band) return a.y - b.y;
    return rtl ? (b.x + b.w) - (a.x + a.w) : a.x - b.x;
  });
}

function checkPage(pi) {
  const pg = S.doc.pages[pi], ls = pg.layers, out = [];
  const panels = panelOrder(ls), texts = ls.filter(l => TEXT_TYPES.includes(l.type) && l.visible);
  const add = (level, l, msg, fixLabel, fix) => out.push({ level, page: pi, id: l?.id, msg, fixLabel, fix });
  const pname = p => `panel ${panels.indexOf(p) + 1}`;
  if (!panels.length) add("warn", null, "This page has no panels.", "Choose a layout", () => { gotoPage(pi); layoutDialog(); });
  panels.forEach(p => {
    if (!p.image && !p.shot) add("info", p, `${pname(p)} has no render and no shot yet.`, "Pose it…", () => { gotoPage(pi); S.sel = p.id; poseForPanel(p); });
    else if (!p.image) add("info", p, `${pname(p)} (${p.shot}) is not rendered yet.`, "Render", () => renderShot(p.shot));
  });
  const safe = safeRect();
  for (const l of texts) {
    const txt = (l.text || "").trim();
    const what = { bubble: "Bubble", vbubble: "Bubble", caption: "Caption", text: l.sfx ? "SFX" : "Text" }[l.type];
    if (!txt) { add("warn", l, `${what} with no text.`, "Delete it", () => { pg.layers.splice(pg.layers.indexOf(l), 1); }); continue; }
    const short = `"${txt.length > 28 ? txt.slice(0, 26) + "…" : txt}"`;
    if (!l.sfx) {
      const [bw, bh] = textBox(l), f = fit(txt, l, bw, bh, S.doc.maxFont || 56);
      if (f.px < PRINT_MIN_PX) add("warn", l, `${what} ${short}: text is ${f.px}px, too small to read in print.`, "Enlarge 25%", () => {
        const cx = l.x + l.w / 2, cy = l.y + l.h / 2; l.w *= 1.25; l.h *= 1.25; l.x = cx - l.w / 2; l.y = cy - l.h / 2; l.fontSize = 0;
      });
      if (txt.length > 140) add("info", l, `${what} ${short} holds ${txt.length} characters; manga bubbles read best under ~100. Split it in two.`, null, null);
    }
    const outside = l.x < safe.x || l.y < safe.y || l.x + l.w > safe.x + safe.w || l.y + l.h > safe.y + safe.h;
    if (outside && !l.sfx) add("warn", l, `${what} ${short} crosses the safe area: it may be cut off when printed.`, "Move inside", () => {
      l.x = clamp(l.x, safe.x, safe.x + safe.w - l.w); l.y = clamp(l.y, safe.y, safe.y + safe.h - l.h);
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
    if (a.sfx || b.sfx) continue;
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

function checkerDialog(all) {
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
      for (const it of fixable) if (!["Pose it…", "Render", "Choose a layout"].includes(it.fixLabel)) it.fix();
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

/* ================================================================ starter templates */
const STARTERS = [
  ["4-koma (gag strip)", "Four equal panels, top to bottom: setup, development, twist, punchline.", `# 4-koma: ki (setup), shō (development), ten (twist), ketsu (punchline)
[Mika] Mika at her desk, staring at an empty notebook.
Mika: Today I'll finally draw my manga!
[Mika] Mika sketching furiously, papers everywhere.
SFX: SCRIBBLE SCRIBBLE
[Mika] Mika holds up a page proudly, sparkles around her.
Mika (shout): DONE!!
[Mika, Cat] The cat is asleep on the finished page, Mika in shock.
Mika: ...Hey.`],
  ["Dialogue page", "Two characters talking: establishing shot, alternating faces, a reaction to close.", `[Aoi, Ren] Establishing: school rooftop at noon, Aoi and Ren sit eating lunch, wide shot.
Caption: Lunch break.
[Aoi] Aoi, waist up, looking at Ren, curious.
Aoi: You've been quiet all day.
[Ren] Ren, chest up, looking away, embarrassed.
Ren: It's nothing.
Ren (thought): I can't tell her yet.
[Aoi] Aoi close-up, leaning in, teasing smile.
Aoi: Liar.
! [Aoi, Ren] Both laughing, the city skyline behind them.`],
  ["Action page", "A big impact panel in the middle, small fast beats around it, sound effects.", `[Kai] Kai skids to a stop in an alley at night, rain, low angle.
SFX: SKRRT
[Shadow] A shadowy figure on a rooftop, red eyes.
Shadow (whisper): Found you.
! [Kai, Shadow] Kai blocks a flying kick, shockwave, dynamic angle, speed lines.
SFX: BOOM
[Kai] Close-up of Kai's face, gritted teeth, determined.
Kai (shout): Is that all you've got?!`],
  ["Cover", "One full-page splash with title and a tagline.", `Title: MY FIRST MANGA
! [Hana] Cover illustration: Hana standing confidently, wind in her hair, cherry blossoms, looking at the viewer, full body.
Caption: Chapter 1 — The Beginning`],
];

/* ================================================================ character sheet (cast) */
const CAST = { list: null };
async function loadCast() { if (!CAST.list) { try { CAST.list = (await api("/api/cast")).cast; } catch { CAST.list = []; } } return CAST.list; }
const castFor = name => (CAST.list || []).find(c => c.name && c.name.toLowerCase() === String(name || "").toLowerCase());
/* fill name-only characters with what the cast knows about them (LoRA, series, looks, girl/boy) */
function enrichChars(chars) {
  return chars.map(c => { const k = castFor(c.name); return k ? { ...c, series: c.series || k.series || "", lora: k.lora || "auto", tags: c.tags || k.tags || "", gender: c.gender || k.gender || "girl", ref: k.ref || undefined } : c; });
}
/* Reference sheet: the character drawn three times (front, and turned either way) on one wide image, from
   the character's LoRA or looks. Its front view then becomes the identity reference (IPAdapter) for the
   character's single-character shots, so the face and outfit stay put from page to page. */
const refShotName = c => "ref_" + String(c.name || "character").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
async function makeRefSheet(c, render) {
  if (!c.name) return toast("Give the character a name first", "err");
  await loadPoseLib();
  const pose = c.pose && P.byId.has(c.pose) && !P.byId.get(c.pose).members ? c.pose : "basic/Standing";
  const scene = { w: 1344, h: 768, prompt: "", chars: [0, 1, 2].map(i => ({ ...newChar(pose, [0.2, 0.5, 0.8][i], 0.96), scale: 0.88, yaw: [0, 35, -35][i] })) };
  const saved = P.scene; P.scene = scene;
  const png = renderPosePNG().toDataURL("image/png");
  P.scene = saved;
  const name = refShotName(c), boy = c.gender === "boy";
  // one character entry: per-view regional prompts stack the LoRA and blend the views, and "back view"
  // in the prompt turns every figure around. The face reference only needs the front third anyway.
  try {
    await post("/api/pose/shot", { name, png, scene, prompt: "character reference sheet, three views of the same character, full body, standing, looking at viewer, same outfit, plain white background, simple background",
      count_tag: boy ? "1boy" : "1girl", extra: { head_inpaint: false },
      characters: [{ name: c.name, series: c.series || "", lora: c.lora || "auto", tags: c.tags || "", gender: c.gender || "girl" }] });
    await loadShots();
    toast(`Reference sheet shot ${name} ready` + (render ? ", rendering on the pod" : ""), "ok");
    if (render) renderShot(name);
  } catch (e) { toast(e.message, "err"); }
}
async function castDialog() {
  await loadCast(); await loadShots();
  const box = modal("Character sheet", "");
  const body = $(".mbody", box);
  const list = CAST.list.map(c => ({ ...c }));
  const draw = () => {
    body.innerHTML = "";
    body.append(h("p", { class: "hint", style: "margin-top:0" },
      "Describe each character once. Shots made from a script or the Pose tab pick up the series, LoRA, looks and girl/boy by name, so the same character looks the same on every page."));
    const tbl = h("div", { class: "casttable" },
      h("div", { class: "casthead" }, ...["Name", "Series", "LoRA", "Looks (tags)", "Who", "Default pose", "Reference sheet", ""].map(t => h("span", {}, t))));
    list.forEach((c, i) => {
      const inp = (k, ph, wid) => h("input", { value: c[k] || "", placeholder: ph, style: wid ? `width:${wid}` : "", oninput: e => c[k] = e.target.value });
      const g = h("select", { onchange: e => c.gender = e.target.value }, h("option", { value: "girl" }, "Girl"), h("option", { value: "boy" }, "Boy")); g.value = c.gender || "girl";
      const poseSel = h("select", { onchange: e => c.pose = e.target.value }, h("option", { value: "" }, "—"),
        ...(P.lib || []).filter(p => !p.members && (p.pack === "Basic" || p.pack === "My poses")).map(p => h("option", { value: p.id }, p.name)));
      poseSel.value = c.pose || "";
      const shot = S.shots.find(q => q.name === refShotName(c));
      const refCell = h("div", { class: "refcell" },
        c.ref ? h("img", { src: thumb(c.ref, 160), title: "Current reference (front view is used)" }) : null,
        ...(shot?.renders || []).filter(r => r !== c.ref).slice(0, 3).map(r => h("img", { src: thumb(r, 160), class: "pick", title: "Use this render as the reference",
          onclick: () => { c.ref = r; draw(); } })),
        h("button", { title: "Render a front + three-quarter sheet of this character on the pod", onclick: async () => { await makeRefSheet(c, true); } },
          shot ? "Re-render" : "Make sheet"),
        c.ref ? h("button", { class: "ghost", title: "Stop using a reference", onclick: () => { delete c.ref; draw(); } }, "✕") : null);
      tbl.append(h("div", { class: "castrow" }, inp("name", "Rem"), inp("series", "Re:Zero"), inp("lora", "auto"), inp("tags", "blue hair, maid outfit"), g, poseSel, refCell,
        h("button", { class: "ghost", title: "Remove", onclick: () => { list.splice(i, 1); draw(); } }, "🗑")));
    });
    body.append(tbl, h("div", { class: "btnrow", style: "margin-top:8px" }, h("button", { onclick: () => { list.push({ name: "", series: "", lora: "auto", tags: "", gender: "girl" }); draw(); } }, "＋ Character")),
      h("p", { class: "hint" }, "LoRA: auto looks the character up on Civitai; none skips it; or give a .safetensors file name or a Civitai link."));
  };
  if (!P.lib) loadPoseLib().then(draw);
  draw();
  box.append(h("div", { class: "mfoot" }, h("div", { class: "spacer" }), h("button", { onclick: closeModal }, "Cancel"), h("button", { class: "primary", onclick: async () => {
    const clean = list.filter(c => (c.name || "").trim()).map(c => ({ ...c, name: c.name.trim() }));
    try { await post("/api/cast", { cast: clean }); CAST.list = clean; toast(`Saved ${clean.length} character${clean.length === 1 ? "" : "s"}`, "ok"); closeModal(); }
    catch (e) { toast(e.message, "err"); }
  } }, "Save")));
}

/* ================================================================ make it manga */
const SFX_HINTS = [
  [/\b(punch|kick|hit|strike|slam|blocks?|clash|impact|crash)/i, ["BAM!", "DOKA!", "GOGOGO"]], [/\b(run|runs|running|dash|rush|chase)/i, ["DASH", "TA TA TA", "ZOOM"]],
  [/\b(door|knock)/i, ["KNOCK KNOCK", "BAM", "GACHA"]], [/\b(rain|storm)/i, ["ZAAAA", "PITTER PATTER"]], [/\b(explo|blast|fire|burn)/i, ["KABOOM", "DOGOOON"]],
  [/\b(heart|blush|love|embarrass|nervous)/i, ["DOKI DOKI", "BA-DUMP"]], [/\b(surpris|shock|gasp|stunned)/i, ["!?", "GASP", "BIKU"]],
  [/\b(silence|quiet|alone|stare|staring)/i, ["…", "SHIIN"]], [/\b(laugh|giggle)/i, ["HAHAHA", "KUSU KUSU"]], [/\b(menac|threat|aura|glare|red eyes)/i, ["GOGOGOGO", "ゴゴゴ"]],
  [/\b(wind|blossom|hair)/i, ["FWOOSH", "SAAA"]], [/\b(walk|step|footstep)/i, ["TAP TAP", "STOMP"]],
];
function sfxIdeas(text) { const out = []; for (const [re, list] of SFX_HINTS) if (re.test(text || "")) out.push(...list); return [...new Set(out)].slice(0, 4); }
function shotPrompt(name) { const s = S.shots.find(q => q.name === name); const m = s?.yaml?.match(/^prompt:\s*"?(.*?)"?\s*$/m); return m ? m[1] : ""; }

function mangaDialog() {
  const box = modal("Make it manga", "small"), body = $(".mbody", box);
  const pg = page(), panels = panelOrder(pg.layers);
  const opts = { style: h("input", { type: "checkbox", checked: true }), gray: h("input", { type: "checkbox", checked: true }), tone: h("input", { type: "checkbox", checked: true }) };
  body.append(h("div", { class: "form" },
    h("label", { class: "chkrow" }, opts.style, " Render this page's shots in black & white manga style (manga_bw), next render"),
    h("label", { class: "chkrow" }, opts.gray, " Show renders already placed in greyscale now"),
    h("label", { class: "chkrow" }, opts.tone, " Add soft screentone shading to each panel (a light gradient, editable)")));
  const sugg = h("div");
  body.append(h("div", { class: "section" }, "Sound effect ideas"), sugg);
  let any = false;
  panels.forEach((p, i) => {
    const text = [shotPrompt(p.shot), ...pg.layers.filter(l => TEXT_TYPES.includes(l.type) && centreIn(l, p)).map(l => l.text)].join(" ");
    const ideas = sfxIdeas(text); if (!ideas.length) return; any = true;
    sugg.append(h("div", { class: "row" }, h("label", {}, `Panel ${i + 1}`), ...ideas.map(w => h("button", { onclick: () => {
      const ww = Math.min(p.w * 0.5, 600), hh = Math.min(p.h * 0.28, 230);
      addLayer({ type: "text", sfx: true, x: p.x + p.w * 0.25, y: p.y + p.h * 0.55 - hh / 2, w: ww, h: hh, text: w, rotate: -8, color: "#ffffff", stroke: "#000000", strokeWidth: 12, font: /[ぁ-んァ-ン]/.test(w) ? "Dela Gothic One" : "Bangers", fontSize: 0 });
      commit("SFX " + w); requestDraw(); toast(`Added "${w}" to panel ${i + 1}`, "ok");
    } }, w))));
  });
  if (!any) sugg.append(h("p", { class: "hint" }, "No ideas from the prompts and dialogue on this page (they come from words like run, hit, door, blush, rain)."));
  box.append(h("div", { class: "mfoot" }, h("div", { class: "spacer" }), h("button", { onclick: closeModal }, "Close"), h("button", { class: "primary", onclick: async () => {
    const shots = [...new Set(panels.map(p => p.shot).filter(Boolean))];
    if (opts.style.checked && shots.length) { try { await post("/api/shot/style", { names: shots, style: "manga_bw" }); await loadShots(); } catch (e) { toast(e.message, "err"); } }
    if (opts.gray.checked) panels.forEach(p => { if (p.image) p.image.gray = true; });
    if (opts.tone.checked) panels.forEach(p => {
      if (pg.layers.some(l => l.type === "tone" && l.clip === p.id)) return;
      const t = normalize({ pages: [{ layers: [{ type: "tone", x: p.x, y: p.y, w: p.w, h: p.h, clip: p.id, seed: Math.floor(Math.random() * 1e6), ...TONE_PRESETS[3][1], density: 0.25, opacity: 0.35, blend: "multiply" }] }] }).pages[0].layers[0];
      t.id = uid(); pg.layers.splice(pg.layers.indexOf(p) + 1, 0, t);
    });
    commit("Made it manga"); requestDraw(); refreshPanels(); renderPageThumbs(); closeModal();
    toast((opts.style.checked && shots.length ? `${shots.length} shot${shots.length > 1 ? "s" : ""} set to manga_bw (re-render to see it). ` : "") + "Page styled.", "ok");
  } }, "Apply")));
}

/* ================================================================ tips */
const TIPS = {
  move: "Click to select, drag to move. Corner handles resize, the round handle rotates. Alt-drag duplicates. Double-click a bubble to type, a panel to reposition its render.",
  hand: "Drag to pan. Hold Space with any tool to pan, Ctrl/⌘ + scroll to zoom.",
  panel: "Drag a frame. Keep gutters (the white gaps) even: about 30 px on this page. Break a panel border only for a big moment.",
  bubble: "Click a panel to drop a template bubble; pick the shape in Bubbles. One idea per bubble, under ~100 characters.",
  vbubble: "Drag to draw a bubble; drag the tail tip toward the speaker's mouth. Oval = speech, cloud = thought, burst = shout, dashed = whisper.",
  text: "Free text with no balloon: narration or off-panel voices. Keep it inside the green safe area.",
  sfx: "Sound effects are part of the art: big, tilted, overlapping the panel. Short words read best (BAM, DOKI).",
  caption: "Captions set time and place (\"The next day.\"). Put them in the panel's top corner where reading starts.",
  tone: "Screentone adds shade without colour. Gradients set mood (dark top = night or dread). Click a panel to fill it.",
  speed: "Focus lines pull the eye to a centre (surprise, impact); parallel lines show motion.",
  page: `Manga reads ${"right to left"}, top to bottom, panel by panel, then bubble by bubble the same way. Big panel = big moment.`,
};
const TIPS_ON = () => { try { return localStorage.getItem("mm.tips") !== "0"; } catch { return true; } };
function showTip(tool) {
  let el = $("#tipcard");
  if (!TIPS_ON() || S.mode === "pose") { if (el) el.hidden = true; return; }
  if (!el) {
    el = h("div", { id: "tipcard" }, h("span", { class: "tt" }), h("button", { class: "ghost", title: "Turn tips off (Help menu turns them back on)", onclick: () => { try { localStorage.setItem("mm.tips", "0"); } catch { } el.hidden = true; } }, "✕"));
    $("#stage").append(el);
  }
  el.hidden = false; $(".tt", el).textContent = "💡 " + (TIPS[tool] || TIPS.page);
}
function toggleTips() { try { localStorage.setItem("mm.tips", TIPS_ON() ? "0" : "1"); } catch { } showTip(S.tool); toast("Tips " + (TIPS_ON() ? "on" : "off")); }

/* ================================================================ guide */
/* docs/SCRIPT_WIZARD.md, shown in a dialog: a small Markdown subset (headings, lists, tables, code) */
function mdToHtml(md) {
  const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
  const out = [], L = md.split("\n");
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (l.startsWith("```")) { const buf = []; while (++i < L.length && !L[i].startsWith("```")) buf.push(esc(L[i])); out.push(`<pre>${buf.join("\n")}</pre>`); continue; }
    if (/^#{1,3} /.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n + 1}>${inline(l.slice(n + 1))}</h${n + 1}>`); continue; }
    if (l.startsWith("|")) {
      const rows = []; while (i < L.length && L[i].startsWith("|")) rows.push(L[i++]); i--;
      const cells = r => r.split("|").slice(1, -1).map(c => c.trim());
      out.push("<table>" + rows.filter((_, k) => k !== 1).map((r, k) => "<tr>" + cells(r).map(c => k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join("") + "</tr>").join("") + "</table>");
      continue;
    }
    if (/^(\d+\.|-) /.test(l)) {
      const ord = /^\d/.test(l), items = [];
      while (i < L.length && /^(\d+\.|-) |^   /.test(L[i])) { if (/^   /.test(L[i]) && items.length) items[items.length - 1] += " " + L[i].trim(); else items.push(L[i].replace(/^(\d+\.|-) /, "")); i++; }
      i--; out.push(`<${ord ? "ol" : "ul"}>${items.map(t => `<li>${inline(t)}</li>`).join("")}</${ord ? "ol" : "ul"}>`); continue;
    }
    if (l.trim()) { const buf = [l]; while (i + 1 < L.length && L[i + 1].trim() && !/^(#|\||```|- |\d+\. )/.test(L[i + 1])) buf.push(L[++i]); out.push(`<p>${inline(buf.join(" "))}</p>`); }
  }
  return out.join("");
}
async function wizardGuide() {
  let md = ""; try { md = await (await fetch("/api/guide")).text(); } catch { md = "Guide not found (docs/SCRIPT_WIZARD.md)."; }
  const box = modal("Script Wizard guide", "mid"); const body = $(".mbody", box);
  const div = h("div", { class: "guide" }); div.innerHTML = mdToHtml(md); body.append(div);
  box.append(h("div", { class: "mfoot" }, h("div", { class: "spacer" }), h("button", { onclick: () => scriptWizard() }, "Open the Script Wizard"), h("button", { class: "primary", onclick: closeModal }, "Close")));
}

/* ================================================================ wiring */
(function initHelpers() {
  const orig = setTool;
  setTool = function (t) { orig(t); showTip(S.tool); };           // eslint-disable-line no-global-assign
  const add = (menu, items) => { const f = MENUS[menu]; MENUS[menu] = () => [...f(), null, ...items()]; };
  add("Page", () => [["Check this page…", () => checkerDialog(false), sc("Check this page")], ["Check every page…", () => checkerDialog(true)], ["Make it manga…", mangaDialog]]);
  add("Pipeline", () => [["Character sheet…", castDialog, sc("Character sheet")]]);
  add("Help", () => [["Script Wizard guide", wizardGuide], [(TIPS_ON() ? "Hide" : "Show") + " tips", toggleTips], ["Starter templates…", () => scriptWizard("starter")]]);
  SHORTCUTS.push(["Page", "mod+shift+c", "Check this page", () => checkerDialog(false)], ["Pipeline", "mod+shift+u", "Character sheet", () => castDialog()]);
  for (const r of SHORTCUTS.slice(-2)) SC_MAP.set(r[1], r);
  buildMenus();
  loadCast();
  setTimeout(() => showTip(S.tool), 1500);
  // fetch the pose library while the editor is idle, so the Pose tab opens instantly
  (window.requestIdleCallback || (f => setTimeout(f, 2500)))(() => loadPoseLib().then(() => status("")), { timeout: 5000 });
})();
