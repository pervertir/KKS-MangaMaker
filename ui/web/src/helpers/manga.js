import { $, h, post, uid } from "../editor/core.js";
import { addLayer } from "../editor/creation.js";
import { commit } from "../editor/history.js";
import { refreshPanels, toast } from "../editor/misc.js";
import { closeModal, modal } from "../editor/modal.js";
import { renderPageThumbs } from "../editor/pages.js";
import { loadShots } from "../editor/shots.js";
import { S, normalize, page } from "../editor/state.js";
import { TONE_PRESETS } from "../editor/tools.js";
import { panelOrder, requestDraw } from "../editor/view.js";
import { TEXT_TYPES, centreIn } from "./checker.js";

/* ================================================================ make it manga */
export const SFX_HINTS = [
  [/\b(punch|kick|hit|strike|slam|blocks?|clash|impact|crash)/i, ["BAM!", "DOKA!", "GOGOGO"]], [/\b(run|runs|running|dash|rush|chase)/i, ["DASH", "TA TA TA", "ZOOM"]],
  [/\b(door|knock)/i, ["KNOCK KNOCK", "BAM", "GACHA"]], [/\b(rain|storm)/i, ["ZAAAA", "PITTER PATTER"]], [/\b(explo|blast|fire|burn)/i, ["KABOOM", "DOGOOON"]],
  [/\b(heart|blush|love|embarrass|nervous)/i, ["DOKI DOKI", "BA-DUMP"]], [/\b(surpris|shock|gasp|stunned)/i, ["!?", "GASP", "BIKU"]],
  [/\b(silence|quiet|alone|stare|staring)/i, ["…", "SHIIN"]], [/\b(laugh|giggle)/i, ["HAHAHA", "KUSU KUSU"]], [/\b(menac|threat|aura|glare|red eyes)/i, ["GOGOGOGO", "ゴゴゴ"]],
  [/\b(wind|blossom|hair)/i, ["FWOOSH", "SAAA"]], [/\b(walk|step|footstep)/i, ["TAP TAP", "STOMP"]],
];
export function sfxIdeas(text) { const out = []; for (const [re, list] of SFX_HINTS) if (re.test(text || "")) out.push(...list); return [...new Set(out)].slice(0, 4); }
export function shotPrompt(name) { const s = S.shots.find(q => q.name === name); const m = s?.yaml?.match(/^prompt:\s*"?(.*?)"?\s*$/m); return m ? m[1] : ""; }

export function mangaDialog() {
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
