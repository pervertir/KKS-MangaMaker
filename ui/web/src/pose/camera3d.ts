/* Pinhole camera of a Pose studio 3D background, in plain maths so the 2D studio can use it without
   loading three.js: where the floor is under a figure, how big a figure is there, and where the scene's
   axes vanish. Metres, Y up, the floor at y = 0. Yaw turns about Y (0 looks toward -Z), pitch tilts
   up (+) or down (-). The focal length is in 35 mm terms across the long side, like three.js. */

export interface Cam3D { x: number; y: number; z: number; yaw: number; pitch: number; focal: number }
type V = [number, number, number];

const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function basis(cam: Cam3D) {
  const y = cam.yaw * Math.PI / 180, p = cam.pitch * Math.PI / 180;
  const f: V = [-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
  const r: V = [Math.cos(y), 0, -Math.sin(y)];
  const u: V = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}
export const focalPx = (cam: Cam3D, W: number, H: number) => cam.focal / 35 * Math.max(W, H);

/* world -> canvas pixels and depth along the view; null behind the camera */
export function toScreen(cam: Cam3D, W: number, H: number, X: V): { x: number; y: number; d: number } | null {
  const { f, r, u } = basis(cam), d: V = [X[0] - cam.x, X[1] - cam.y, X[2] - cam.z], z = dot(d, f);
  if (z <= 1e-6) return null;
  const k = focalPx(cam, W, H);
  return { x: W / 2 + k * dot(d, r) / z, y: H / 2 - k * dot(d, u) / z, d: z };
}
/* canvas pixel at a depth along the view -> world */
export function toWorld(cam: Cam3D, W: number, H: number, sx: number, sy: number, depth: number): V {
  const { f, r, u } = basis(cam), k = focalPx(cam, W, H), a = (sx - W / 2) / k, b = -(sy - H / 2) / k;
  return [0, 1, 2].map(i => [cam.x, cam.y, cam.z][i] + (f[i] + r[i] * a + u[i] * b) * depth) as V;
}
/* the floor under a canvas pixel: its depth, or null when the pixel is above the horizon */
export function floorDepth(cam: Cam3D, W: number, H: number, sx: number, sy: number): number | null {
  const { f, r, u } = basis(cam), k = focalPx(cam, W, H), a = (sx - W / 2) / k, b = -(sy - H / 2) / k;
  const dy = f[1] + r[1] * a + u[1] * b;
  if (dy >= -1e-6) return null;
  const t = -cam.y / dy;
  return t > 0.05 ? t : null;
}
/* pixels per metre at a depth */
export const pxPerMetre = (cam: Cam3D, W: number, H: number, depth: number) => focalPx(cam, W, H) / depth;

/* Vanishing points of the world X, Y and Z axes as fractions of the canvas, or null where the axis is
   parallel to the picture (its lines then keep one screen angle, listed in dirs, degrees). */
export function vanishing(cam: Cam3D, W: number, H: number): { vps: ([number, number] | null)[]; dirs: number[]; horizon: number | null } {
  const { f, r, u } = basis(cam), k = focalPx(cam, W, H), vps: ([number, number] | null)[] = [], dirs: number[] = [];
  for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V[]) {
    let z = dot(ax, f), x = dot(ax, r), y = dot(ax, u);
    if (z < 0) { z = -z; x = -x; y = -y; }
    const sx = W / 2 + k * x / Math.max(z, 1e-9), sy = H / 2 - k * y / Math.max(z, 1e-9);
    if (z < 1e-4 || Math.abs(sx - W / 2) > 40 * Math.max(W, H) || Math.abs(sy - H / 2) > 40 * Math.max(W, H)) {
      vps.push(null); dirs.push(+(Math.atan2(-y, x) * 180 / Math.PI).toFixed(2));
    } else vps.push([+(sx / W).toFixed(5), +(sy / H).toFixed(5)]);
  }
  const p = cam.pitch * Math.PI / 180, hz = H / 2 + focalPx(cam, W, H) * Math.tan(p);
  return { vps, dirs, horizon: Math.abs(p) < Math.PI / 2 - 0.01 ? hz / H : null };
}
