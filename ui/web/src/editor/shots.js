import { $, api, h, post } from "./core.js";
import { setPanelImage } from "./creation.js";
import { thumb } from "./images.js";
import { renderShot, startJob } from "./jobs.js";
import { renderLibrary } from "./library.js";
import { toast } from "./misc.js";
import { closeModal, modal } from "./modal.js";
import { renderPanelsTab } from "./panels-tab.js";
import { refreshProps, rowOf } from "./props.js";
import { S, selL } from "./state.ts";

/* ================================================================ shots */
export async function loadShots() {
  try { S.shots = await api("/api/shots"); } catch (e) { toast(e.message, "err"); }
  if (S.libTab === "shots") renderLibrary();
  if (selL()?.type === "panel") refreshProps();
  if (S.doc) renderPanelsTab();
}
export function shotDialog(name, creating) {
  if (creating) {
    const box = modal("New shot", "small");
    const n = h("input", { placeholder: "ch1_s01" }), s = h("input", { placeholder: "Re:Zero (used when a line has no series)" });
    const c = h("textarea", { rows: 5, style: "flex:1;font:13px/1.5 ui-monospace,Menlo,monospace", placeholder: "Rem | Re:Zero\nRam | Re:Zero\nEmilia" });
    $(".mbody", box).append(h("div", { class: "form" }, rowOf("Folder name", n), rowOf("Characters", c), rowOf("Series", s),
      h("p", { class: "hint" }, "One character per line, left to right as they stand in the frame. \"Name | Series\" or just a name. " +
        "Each gets lora: auto, so its LoRA is looked up on Civitai and downloaded on the pod when you render. " +
        "Then pose in CharaStudio: F11 the characters, swap each to the OpenPose card, F11 again, and use Grab from Studio.")));
    box.append(h("div", { class: "mfoot" }, h("button", { onclick: closeModal }, "Cancel"), h("button", { class: "primary", onclick: async () => {
      const chars = c.value.split(/[\n,]/).map(x => x.trim()).filter(Boolean).map(line => {
        const [name, series] = line.split("|").map(x => x.trim());
        return { name, series: series || s.value.trim() };
      });
      if (!chars.length) return toast("Add at least one character", "err");
      try { await post("/api/shot/new", { name: n.value.trim(), characters: chars }); await loadShots(); shotDialog(n.value.trim()); }
      catch (e) { toast(e.message, "err"); }
    } }, "Create")));
    setTimeout(() => n.focus(), 0);
    return;
  }
  const box = modal("Shots", "");
  let cur = name || S.shots[0]?.name;
  const listEl = h("div", { class: "shotlist" }), mid = h("div"), prev = h("div", { class: "shotprev" });
  $(".mbody", box).append(h("div", { class: "shotedit" }, listEl, mid, prev));
  const foot = h("div", { class: "mfoot" }); box.append(foot);
  const show = () => {
    listEl.innerHTML = ""; mid.innerHTML = ""; prev.innerHTML = ""; foot.innerHTML = "";
    for (const s of S.shots) listEl.append(h("div", { class: s.name === cur ? "on" : "", onclick: () => { cur = s.name; show(); } }, s.name));
    listEl.append(h("button", { style: "margin-top:8px;width:100%", onclick: () => shotDialog(null, true) }, "＋ New shot"));
    const s = S.shots.find(q => q.name === cur);
    if (!s) { mid.append(h("p", { class: "hint" }, "No shots yet.")); return; }
    const ta = h("textarea", { value: s.yaml, spellcheck: false });
    mid.append(h("div", { class: "hint", style: "margin-top:0" }, `shots/${s.name}/${s.sidecar || "shot.yaml"} — prompt, characters, style (${S.cat.styles.join(", ")}), seed…`), ta);
    const imgBlock = (ref, label) => ref ? [h("img", { src: thumb(ref, 600) }), h("div", { class: "lbl" }, label)] : [h("div", { class: "lbl" }, label + ": none")];
    prev.append(...imgBlock(s.renders[0], "Latest render"), ...imgBlock(s.pose, "Pose (OpenPose capture)"), ...imgBlock(s.reference, "Reference"));
    const seed = h("input", { type: "number", placeholder: "seed (random)", style: "width:140px" });
    const saveY = async () => { await post("/api/shot/yaml", { name: s.name, yaml: ta.value }); s.yaml = ta.value; };
    foot.append(
      h("button", { onclick: async () => {
        if (!confirm(`Copy the two newest F11 renders from UserData/cap into ${s.name}?\nNewest = pose.png, the one before = reference.png (overwrites).`)) return;
        startJob({ cmd: "grab", shot: s.name });
      } }, "Grab from Studio"),
      h("div", { class: "spacer" }), seed,
      h("button", { onclick: async () => { try { await saveY(); toast("Saved", "ok"); } catch (e) { toast(e.message, "err"); } } }, "Save"),
      h("button", { class: "primary", disabled: !s.pose, onclick: async () => {
        try { await saveY(); renderShot(s.name, seed.value); closeModal(); } catch (e) { toast(e.message, "err"); }
      } }, "Save & render on pod"),
      selL()?.type === "panel" && s.renders[0] ? h("button", { onclick: () => { setPanelImage(selL(), s.renders[0], s.name); closeModal(); } }, "Use in selected panel") : "");
  };
  show();
}
