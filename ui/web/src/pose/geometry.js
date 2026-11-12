import { BODY_PARENT, CARRY, FIG_H, P, SWAP_BODY, poseMiss, shownPts } from "./model.js";

/* ---------------------------------------------------------------- geometry */
/* 3D pose -> canvas pixels for one character. Returns {body[18], hands[2][21], k}. Mirroring swaps the
   anatomical sides so the colours stay correct (a mirrored right arm is drawn as a left arm). */
export function project(c, W, H) {
  const pose = P.byId.get(c.pose); if (!pose) return null;
  const k = c.scale * H / FIG_H;
  const yaw = c.yaw * Math.PI / 180, pit = c.pitch * Math.PI / 180, rol = c.roll * Math.PI / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit), cr = Math.cos(rol), sr = Math.sin(rol);
  let src = pose.body;
  if (src.some(p => !p)) {                                   // a null joint waits on the joint it hangs from
    src = [...src];
    for (let n = 0; n < 3; n++) src.forEach((p, i) => { if (!p) src[i] = src[BODY_PARENT[i]]; });
    src = src.map(p => p || [0, 0, 0]);
  }
  let { miss, hoff } = poseMiss(pose, c);
  const hipY = (src[8][1] + src[11][1]) / 2;
  const ax = c.x * W, ay = c.y * H;
  const tf = ([x, y, z]) => {
    if (c.flip) x = -x;
    let X = x * cy + z * sy, Z = -x * sy + z * cy;          // yaw around the vertical axis
    let Y = y - hipY; const Y2 = Y * cp - Z * sp; Z = Y * sp + Z * cp; Y = Y2 + hipY;  // pitch around the hips
    const sx = X * k, syy = -(Y - hipY) * k;                  // screen, relative to the hips
    return [ax + sx * cr - syy * sr, ay - hipY * k + sx * sr + syy * cr, Z];
  };
  let body = src.map(tf);
  let hands = (pose.hands || [[], []]).map(hd => hd.map(p => tf(p || [0, 0, 0])));      // [left, right]
  if (c.flip) { body = SWAP_BODY.map(i => body[i]); hands = [hands[1], hands[0]]; miss = new Set([...miss].map(i => SWAP_BODY[i])); hoff = [hoff[1], hoff[0]]; }
  const off = (key) => { const e = c.edits[key]; return e ? [e[0] * k, e[1] * k] : [0, 0]; };
  const add = (p, d) => [p[0] + d[0], p[1] + d[1], p[2]];
  body = body.map((p, i) => {
    let d = off(i);
    for (const [src, deps] of Object.entries(CARRY)) if (deps.includes(i)) { const o = off(+src); d = [d[0] + o[0], d[1] + o[1]]; }
    return add(p, d);
  });
  hands = hands.map((hd, s) => {
    const wrist = off(s === 0 ? 7 : 4);
    return hd.map((p, i) => { const o = off(`h${s ? "R" : "L"}${i}`); return add(p, [wrist[0] + o[0], wrist[1] + o[1]]); });
  });
  // like a real pose detector: face points turned away from the camera are not drawn (a back view has
  // no nose or eyes), which is what tells the model the figure faces away
  const hide = new Set(miss), nz = body[1][2];
  if (body[0][2] < nz - 0.01) hide.add(0);
  for (const i of [14, 15]) if (body[i][2] < nz - 0.005) hide.add(i);
  for (const i of [16, 17]) if (body[i][2] < nz - 0.09) hide.add(i);
  return { body, hands, k, hide, miss, hoff };
}
export function bounds(pr) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of shownPts(pr)) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const pad = 0.06 * pr.k;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}
