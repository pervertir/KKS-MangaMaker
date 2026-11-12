/* Pose studio: several characters as OpenPose skeletons on one canvas, posed from the pose library
   (3D keypoints, so each figure can be turned, tilted and mirrored), then fine-tuned joint by joint.
   "Save to shot" writes pose.png + pose_scene.json into shots/<name>/ and the render runs on the pod
   exactly like a Studio capture, so no game is needed. Loaded after app.js and uses its helpers. */

export const P = {
  lib: null, byId: new Map(), packs: [], filter: { q: "", pack: "" },
  scene: null, sel: null, joint: null, undo: [], redo: [], shot: "", panel: null,
  view: { s: 1, ox: 0, oy: 0 }, drag: null, showHands: true, dirty: false, ik: true,
};

/* OpenPose drawing tables (COCO-18 body as ControlNet's preprocessors draw it) */
export const LIMBS = [[1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17]];
export const KCOL = ["#ff0000", "#ff5500", "#ffaa00", "#ffff00", "#aaff00", "#55ff00", "#00ff00", "#00ff55", "#00ffaa", "#00ffff", "#00aaff", "#0055ff", "#0000ff", "#5500ff", "#aa00ff", "#ff00ff", "#ff00aa", "#ff0055"];
export const HAND_EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20]];
export const JOINT_NAMES = ["nose", "neck", "right shoulder", "right elbow", "right wrist", "left shoulder", "left elbow", "left wrist", "right hip", "right knee",
  "right ankle", "left hip", "left knee", "left ankle", "right eye", "left eye", "right ear", "left ear"];
// mirrored figure: anatomical left <-> right
export const SWAP_BODY = [0, 1, 5, 6, 7, 2, 3, 4, 11, 12, 13, 8, 9, 10, 15, 14, 17, 16];
// dragging these joints carries their dependants along
export const CARRY = { 0: [14, 15, 16, 17], 4: ["hR"], 7: ["hL"], 1: [] };
export const ASPECTS = [["832x1216", "Portrait 2:3 (832×1216)"], ["896x1152", "Portrait 7:9 (896×1152)"], ["1024x1024", "Square (1024×1024)"],
  ["1152x896", "Landscape 9:7 (1152×896)"], ["1216x832", "Landscape 3:2 (1216×832)"], ["768x1344", "Tall (768×1344)"], ["1344x768", "Wide (1344×768)"]];
export const FIG_H = 1.75;    // metres that a scale-1 figure spans over the canvas height
/* Joints a figure does not have. A pose from a picture marks what the picture did not show (a figure cut
   by the frame has no legs): the joint keeps a place, hung in the rest pose from the nearest seen joint,
   with a fourth value 0 ([x, y, z, 0]; null and pose.miss are read too), and is not drawn, nor are its
   bones. Hand points are marked the same way. A figure can add joints back (c.show) or take more away
   (c.cut): joint numbers and "hL" / "hR", by anatomical side so they follow a mirrored figure. */
export const BODY_PARENT = [1, 1, 1, 2, 3, 1, 5, 6, 1, 8, 9, 1, 11, 12, 0, 0, 14, 15];
export const OUTWARD = { 2: [3, 4, "hR"], 3: [4, "hR"], 5: [6, 7, "hL"], 6: [7, "hL"], 8: [9, 10], 9: [10], 11: [12, 13], 12: [13] };   // cutting a joint cuts the limb beyond it
export const offPt = p => !p || (p.length > 3 && !p[3]);
export function poseMiss(pose, c = {}) {
  const show = new Set(c.show || []), cut = new Set(c.cut || []);
  const miss = new Set([...pose.body.keys()].filter(i => offPt(pose.body[i])).concat(pose.miss || []).filter(i => !show.has(i)));
  for (const k of cut) if (typeof k === "number") miss.add(k);
  const hoff = (pose.hands || [[], []]).map((hd, s) => { const key = s ? "hR" : "hL"; return hd.map(pt => cut.has(key) || (offPt(pt) && !show.has(key))); });
  return { miss, hoff };
}
export const anatKey = (c, key) => !c.flip ? key : typeof key === "number" ? SWAP_BODY[key] : key === "hL" ? "hR" : "hL";
export const partName = key => typeof key === "number" ? JOINT_NAMES[key] : key === "hL" ? "left hand" : "right hand";
/* show or hide a joint or hand of a figure; `key` is the part as displayed */
export function setPart(c, key, on) {
  const pose = P.byId.get(c.pose); if (!pose) return;
  for (const k of on ? [key] : [key, ...(OUTWARD[key] || [])]) {
    const a = anatKey(c, k);
    c.show = (c.show || []).filter(q => q !== a); c.cut = (c.cut || []).filter(q => q !== a);
    const base = poseMiss(pose), gone = typeof a === "number" ? base.miss.has(a) : (base.hoff[a === "hL" ? 0 : 1] || []).some(Boolean);
    if (on && gone) c.show.push(a);
    if (!on) c.cut.push(a);
  }
}
/* the points a figure has (for its outline and framing): everything but the missing joints and hand points */
export const shownPts = pr => { const pts = [...pr.body.filter((_, i) => !pr.miss?.has(i)), ...pr.hands.flatMap((hd, s) => hd.filter((_, i) => !pr.hoff?.[s]?.[i]))]; return pts.length ? pts : pr.body; };
