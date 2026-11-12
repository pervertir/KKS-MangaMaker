import { $, $$, h } from "../editor/core.js";
import { closeModal, modal } from "../editor/modal.js";
import { loadShots } from "../editor/shots.js";
import { S } from "../editor/state.js";
import { renderPoseLib, usePose } from "./library.js";
import { P } from "./model.js";
import { openPoseStudio, setMode } from "./open.js";
import { psDown, psMove, psUp, psWheel } from "./pointer.js";
import { pcommit } from "./scene.js";
import { poseFromImage, useGroup } from "./side.js";
import { pToScene, pcv, pfit } from "./view.js";


/* runs once at start-up, in the original order (see main.js) */
export function init_pose_wiring() {
  /* ---------------------------------------------------------------- wiring */
  (function initPoseStudio() {
    $$("#modetabs button").forEach(b => b.onclick = () => setMode(b.dataset.mode));
    const cv = pcv();
    cv.addEventListener("pointerdown", psDown); cv.addEventListener("pointermove", psMove);
    cv.addEventListener("pointerup", psUp); cv.addEventListener("pointercancel", psUp);
    cv.addEventListener("wheel", psWheel, { passive: false });
    const st = $("#psstage");
    st.addEventListener("dragover", e => { if (e.dataTransfer.types.includes("application/x-pose")) e.preventDefault(); });
    st.addEventListener("drop", e => {
      const id = e.dataTransfer.getData("application/x-pose"); if (!id) return; e.preventDefault();
      const grp = P.byId.get(id); if (grp?.members) return useGroup(grp);
      const r = cv.getBoundingClientRect(); usePose(id, pToScene(e.clientX - r.left, e.clientY - r.top));
    });
    new ResizeObserver(() => { if (S.mode === "pose") pfit(); }).observe(st);
    let qT = null;
    $("#psq").addEventListener("input", e => { clearTimeout(qT); qT = setTimeout(() => { P.filter.q = e.target.value; renderPoseLib(); }, 150); });
    $("#pspack").addEventListener("change", e => { P.filter.pack = e.target.value; renderPoseLib(); });
    $("#psclear").onclick = () => { if (P.scene.chars.length && !confirm("Remove every character from this scene?")) return; P.scene.chars = []; P.sel = null; pcommit("Cleared"); };
    $("#psnew").onclick = () => { if (P.dirty && !confirm("Start a new pose scene? Unsaved changes are lost.")) return; openPoseStudio({ shot: "" }); };
    $("#psopen").onclick = async () => {
      await loadShots();
      const box = modal("Open a shot's pose", "small"), body = $(".mbody", box);
      const withScene = S.shots.filter(s => s.scene);
      if (!withScene.length) body.append(h("p", { class: "hint" }, "No shot has a pose scene yet. Shots posed here are saved with one."));
      for (const s of withScene) body.append(h("div", { class: "row" }, h("button", { style: "flex:1;text-align:left", onclick: () => { closeModal(); openPoseStudio({ shot: s.name }); } }, s.name)));
    };
    $("#psback").onclick = () => setMode("page");
    $("#psfromimg").onclick = () => $("#psimgfile").click();
    $("#psimgfile").onchange = e => { poseFromImage(e.target.files[0]); e.target.value = ""; };
    $("#psstage").addEventListener("drop", e => {           // dropping an image file on the canvas does the same
      const f = [...(e.dataTransfer.files || [])].find(x => /^image\//.test(x.type)); if (!f) return; e.preventDefault(); poseFromImage(f);
    });
    $("#psstage").addEventListener("dragover", e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); });
  })();
}
