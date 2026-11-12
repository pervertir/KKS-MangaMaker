import { $, h } from "../editor/core.js";
import { presetThumb } from "../editor/layouts.js";
import { toast } from "../editor/misc.js";
import { closeModal, modal } from "../editor/modal.js";
import { rowOf } from "../editor/props.js";
import { S } from "../editor/state.ts";
import { CAST, loadCast } from "../helpers/cast.js";
import { wizardGuide } from "../helpers/guide.js";
import { STARTERS } from "../helpers/starters.js";
import { wizEditor, wizUnfence } from "./editor.js";
import { WIZ_EXAMPLE, buildFromScript, parseScript, wizRows } from "./script.js";

/* ================================================================ prompt for converting a script with any LLM */
/* The whole prompt lives here (docs/SCRIPT_WIZARD.md carries the same text with default options). It has no
   fence lines of its own: the guide dialog shows that file and its Markdown subset cannot nest code blocks.
   opts: source, reading "rtl"|"ltr", perPage, names (array or comma list), language, tone. */
export function llmScriptPrompt(opts = {}) {
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

export async function wizCopy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { }
  const t = h("textarea", { readOnly: true, style: "position:fixed;left:-9999px;top:0" }); t.value = text; document.body.append(t); t.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch { }
  t.remove(); return ok;
}

/* Sits above the wizard instead of replacing it (modal() has one slot), so the script stays as it is. */
export function llmPromptDialog(ed, defaults) {
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

export const WIZ_LEGEND = [["big", "!"], ["pun", "["], ["name", "Name"], ["pun", "]"], ["desc", " picture prompt"], ["", "   "], ["who", "Name"], ["pun", ": "], ["say", "speech"], ["", "  "], ["think", "thought"], ["", "  "],
  ["shout", "shout"], ["", "  "], ["whisper", "whisper"], ["", "   "], ["key", "Caption"], ["pun", ": "], ["caption", "text"], ["", "   "], ["key", "SFX"], ["pun", ": "], ["sfx", "BAM"], ["", "   "],
  ["key", "Title"], ["pun", ": "], ["title", "TEXT"], ["", "   "], ["brk", "---"], ["", " page   "], ["koma", "# 4-koma"], ["", "  "], ["com", "# note"]];

export function scriptWizard(focus) {
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
