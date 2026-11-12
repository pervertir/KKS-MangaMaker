import { deep } from "../editor/core.js";
import { project } from "./geometry.js";
import { CARRY, P } from "./model.js";

/* ---------------------------------------------------------------- IK */
/* Drag a hand or foot and the arm or leg follows (two-bone IK in the picture plane), drag an elbow or
   knee and the limb swings from the shoulder or hip, drag the nose and the head turns about the neck.
   Soft constraints: bones keep their length, reach eases out near full extension instead of snapping
   straight, a limb never folds through itself (it keeps the side it bends to), and nothing collapses
   to zero length. Alt-drag moves a single joint freely. Works on the figure as projected, so it can
   be combined with turning, mirroring and the joint edits. */
export const LIMB_CHAINS = [[2, 3, 4], [5, 6, 7], [8, 9, 10], [11, 12, 13]];
export const v2 = (a, b) => [b[0] - a[0], b[1] - a[1]], len2 = v => Math.hypot(v[0], v[1]) || 1e-6;
export function setFinal(c, base, key, pos, k) {
  // the edit that puts joint `key` at `pos`, minus whatever its carrier (nose for the face) adds
  let carry = [0, 0];
  for (const [src, deps] of Object.entries(CARRY)) if (deps.includes(key) && c.edits[src]) carry = c.edits[src];
  c.edits[key] = [(pos[0] - base[key][0]) / k - carry[0], (pos[1] - base[key][1]) / k - carry[1]];
}
export function ikDrag(d, c, pt) {
  if (typeof d.key !== "number") return false;
  const { w, h } = P.scene, cur = d.pr.body, k = d.pr.k;
  const base = project({ ...d.orig, edits: {} }, w, h).body;
  c.edits = deep(d.orig.edits);
  const chain = LIMB_CHAINS.find(ch => ch.includes(d.key) && ch[0] !== d.key);
  if (chain && chain.some(i => d.pr.miss.has(i))) return false;         // a limb with a joint out of the picture: move just this one
  if (chain) {
    const [ri, mi, ei] = chain, R = cur[ri], M = cur[mi], E = cur[ei];
    const L1 = len2(v2(R, M)), L2 = len2(v2(M, E));
    if (d.key === ei) {                                       // end effector: two-bone solve
      let t = v2(R, [pt.x, pt.y]), dist = len2(t);
      const u = [t[0] / dist, t[1] / dist], dmax = L1 + L2, knee = 0.96 * dmax, dmin = Math.abs(L1 - L2) + 0.06 * dmax;
      if (dist > knee) dist = knee + (dmax - knee) * (1 - Math.exp(-(dist - knee) / (dmax - knee)));   // soft reach
      dist = Math.max(dist, dmin);
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist), hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const side = Math.sign(u[0] * (M[1] - R[1]) - u[1] * (M[0] - R[0])) || d.side || 1;       // keep the bend side
      d.side = side;
      const n = [-u[1] * side, u[0] * side];
      const mid = [R[0] + u[0] * a + n[0] * hh, R[1] + u[1] * a + n[1] * hh], end = [R[0] + u[0] * dist, R[1] + u[1] * dist];
      setFinal(c, base, mi, mid, k); setFinal(c, base, ei, end, k);
      return true;
    }
    // middle joint: swing the upper bone from the root, the lower bone keeps its direction
    const t = v2(R, [pt.x, pt.y]), tl = len2(t);
    const mid = [R[0] + t[0] / tl * L1, R[1] + t[1] / tl * L1], dm = v2(M, mid);
    setFinal(c, base, mi, mid, k); setFinal(c, base, ei, [E[0] + dm[0], E[1] + dm[1]], k);
    return true;
  }
  if (d.key === 0 || [14, 15, 16, 17].includes(d.key)) {    // head: rotate the face points about the neck
    const N = cur[1], a0 = Math.atan2(cur[d.key][1] - N[1], cur[d.key][0] - N[0]), a1 = Math.atan2(pt.y - N[1], pt.x - N[0]);
    let da = a1 - a0; da = Math.atan2(Math.sin(da), Math.cos(da));
    da = Math.sign(da) * Math.min(Math.abs(da), 1.4);                   // soft limit ~80° either way
    const cs = Math.cos(da), sn = Math.sin(da);
    delete c.edits[0];                                                   // face points get their own edits below
    for (const i of [0, 14, 15, 16, 17]) {
      const q = v2(N, cur[i]);
      setFinal(c, base, i, [N[0] + q[0] * cs - q[1] * sn, N[1] + q[0] * sn + q[1] * cs], k);
    }
    return true;
  }
  return false;                                                          // neck, hips: plain joint move
}
