import { $, api, h, post } from "../editor/core.js";
import { thumb } from "../editor/images.js";
import { renderShot } from "../editor/jobs.js";
import { toast } from "../editor/misc.js";
import { closeModal, modal } from "../editor/modal.js";
import { loadShots } from "../editor/shots.js";
import { S } from "../editor/state.js";
import { renderPosePNG } from "../pose/draw.js";
import { loadPoseLib } from "../pose/library.js";
import { P } from "../pose/model.js";
import { newChar } from "../pose/scene.js";

/* ================================================================ character sheet (cast) */
export const CAST = { list: null };
export async function loadCast() { if (!CAST.list) { try { CAST.list = (await api("/api/cast")).cast; } catch { CAST.list = []; } } return CAST.list; }
export const castFor = name => (CAST.list || []).find(c => c.name && c.name.toLowerCase() === String(name || "").toLowerCase());
/* fill name-only characters with what the cast knows about them (LoRA, series, looks, girl/boy) */
export function enrichChars(chars) {
  return chars.map(c => { const k = castFor(c.name); return k ? { ...c, series: c.series || k.series || "", lora: k.lora || "auto", tags: c.tags || k.tags || "", gender: c.gender || k.gender || "girl", ref: k.ref || undefined } : c; });
}
/* Reference sheet: the character drawn three times (front, and turned either way) on one wide image, from
   the character's LoRA or looks. Its front view then becomes the identity reference (IPAdapter) for the
   character's single-character shots, so the face and outfit stay put from page to page. */
export const refShotName = c => "ref_" + String(c.name || "character").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
export async function makeRefSheet(c, render) {
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
export async function castDialog() {
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
