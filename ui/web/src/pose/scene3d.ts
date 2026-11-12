import { api, post } from "../editor/core.js";
import { toast } from "../editor/misc.js";
import { floorDepth, pxPerMetre, toWorld, vanishing, type Cam3D } from "./camera3d.ts";
import { project } from "./geometry.js";
import { FIG_H, LIMBS, P as PS } from "./model.js";

const P = PS as any;

/* A 3D background behind the Pose studio's figures. three.js loads only when a scene first uses one.
   The room is drawn under the skeletons as a shaded preview; figures stand on its floor (their size
   follows the camera); saving the shot also writes depth.png (room + figures as simple volumes) and
   lines.png (the room's edges, hidden behind the figures), which the pod render adds as depth and
   line-art ControlNet passes on the same union model. */

export interface Bg3D {
  room: string;          // a starter room key, or "model"
  model?: string;        // mp: ref of an imported .glb
  cam: Cam3D;
  ground: boolean;       // figures stand on the floor and take their size from the camera
  lines: boolean;        // send the room's line art too
  alpha: number;         // preview opacity
  vps?: ([number, number] | null)[];
  dirs?: number[];
}

export const ROOMS: [string, string][] = [
  ["classroom", "Classroom"], ["bedroom", "Bedroom"], ["corridor", "School corridor"], ["street", "Street"],
  ["cafe", "Café"], ["rooftop", "Rooftop"], ["empty", "Empty floor"],
];
const ROOM_CAM: Record<string, Cam3D> = {
  classroom: { x: 0, y: 1.45, z: 0.9, yaw: 0, pitch: -4, focal: 24 },
  bedroom: { x: 0.6, y: 1.4, z: 0.8, yaw: 10, pitch: -6, focal: 20 },
  corridor: { x: 0, y: 1.5, z: 0.8, yaw: 0, pitch: 0, focal: 28 },
  street: { x: 0, y: 1.6, z: 8, yaw: 0, pitch: 0, focal: 30 },
  cafe: { x: 0.5, y: 1.4, z: 0.8, yaw: -12, pitch: -5, focal: 22 },
  rooftop: { x: 0, y: 1.6, z: 1.2, yaw: 0, pitch: 2, focal: 28 },
  empty: { x: 0, y: 1.5, z: 6, yaw: 0, pitch: -6, focal: 35 },
  model: { x: 0, y: 1.5, z: 5, yaw: 0, pitch: -4, focal: 30 },
};
export function newBg3D(room = "classroom"): Bg3D {
  return { room, cam: { ...(ROOM_CAM[room] || ROOM_CAM.empty) }, ground: true, lines: true, alpha: 0.55 };
}
export const bg = (): Bg3D | null => (P.scene as any)?.bg3d || null;

/* ---------------------------------------------------------------- figures on the floor */
const lastGs = new WeakMap<object, number>();
/* the size a figure would have standing where its feet are (c.y is the floor line, c.x the hips) */
export function groundScale(c: any): number | null {
  const b = bg(); if (!b) return null;
  const { w, h } = P.scene, d = floorDepth(b.cam, w, h, c.x * w, c.y * h);
  return d == null ? null : pxPerMetre(b.cam, w, h, d) * FIG_H / h;
}
/* Keep grounded figures the right size for where they stand. A change of size by hand (handles, wheel,
   slider) is kept as the figure's own height factor (c.tall, 1 = the pose's own size), so it carries when the figure moves. */
export function groundFigures() {
  const b = bg(); if (!b?.ground) return;
  for (const c of P.scene.chars as any[]) {
    const gs = groundScale(c); if (!gs) continue;
    const prev = lastGs.get(c);
    if (c.tall == null) c.tall = 1;
    else if (prev && Math.abs(c.scale - c.tall * prev) > 1e-4) c.tall = +(c.scale / prev).toFixed(4);
    c.scale = c.tall * gs; lastGs.set(c, gs);
  }
}

/* ---------------------------------------------------------------- three.js */
let THREE: any = null, GLTF: any = null, loading: Promise<void> | null = null;
const T: any = { renderer: null, scene: null, room: null, figs: null, cam: null, roomKey: "", preview: null, previewKey: "", models: new Map() };
export const ready = () => !!THREE;
export function load3D(onReady?: () => void) {
  if (!loading) loading = (async () => {
    THREE = await import("three");
    GLTF = (await import("three/examples/jsm/loaders/GLTFLoader.js")).GLTFLoader;
    T.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    T.renderer.setPixelRatio(1);
    T.scene = new THREE.Scene();
    T.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 6, 4); T.scene.add(sun);
    T.figs = new THREE.Group(); T.figs.visible = false; T.scene.add(T.figs);
    T.cam = new THREE.PerspectiveCamera(40, 1, 0.05, 500); T.cam.rotation.order = "YXZ"; T.cam.filmGauge = 35;
  })().catch(e => { loading = null; toast("3D view could not start: " + e.message, "err"); throw e; });
  if (onReady) loading.then(onReady, () => { });
  return loading;
}

const mat = (color: number) => new THREE.MeshLambertMaterial({ color });
function box(g: any, w: number, h: number, d: number, x: number, y: number, z: number, color = 0xd8d2c4) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); m.position.set(x, y + h / 2, z); g.add(m); return m;
}
function cyl(g: any, r: number, h: number, x: number, y: number, z: number, color = 0x9a9a9a) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), mat(color)); m.position.set(x, y + h / 2, z); g.add(m); return m;
}
/* an open-fronted room: floor, ceiling, back and side walls, the camera looking in from +Z */
function shell(g: any, w: number, hgt: number, d: number, floor = 0xb89a74, wall = 0xe8e2d4) {
  box(g, w, 0.02, d, 0, -0.02, -d / 2 + 1, floor);
  box(g, w, 0.02, d, 0, hgt, -d / 2 + 1, 0xf2f0ea);
  box(g, w, hgt, 0.1, 0, 0, -d + 1, wall);
  box(g, 0.1, hgt, d, -w / 2, 0, -d / 2 + 1, wall);
  box(g, 0.1, hgt, d, w / 2, 0, -d / 2 + 1, wall);
}
function windowOn(g: any, side: number, x: number, z: number, w: number, h: number, y: number) {
  box(g, 0.06, h, w, x - side * 0.04, y, z, 0xbfd8e8);
  box(g, 0.12, 0.06, w + 0.1, x - side * 0.05, y - 0.06, z, 0xf5f5f5);
  box(g, 0.12, 0.06, w + 0.1, x - side * 0.05, y + h, z, 0xf5f5f5);
  box(g, 0.12, h, 0.05, x - side * 0.05, y, z, 0xf5f5f5);
}
function desk(g: any, x: number, z: number) {
  box(g, 0.65, 0.03, 0.45, x, 0.7, z, 0xc49a6c);
  for (const [dx, dz] of [[-0.29, -0.19], [0.29, -0.19], [-0.29, 0.19], [0.29, 0.19]]) box(g, 0.03, 0.7, 0.03, x + dx, 0, z + dz, 0x707070);
  box(g, 0.4, 0.03, 0.4, x, 0.42, z + 0.5, 0xc49a6c);
  box(g, 0.4, 0.4, 0.03, x, 0.45, z + 0.7, 0xc49a6c);
  for (const [dx, dz] of [[-0.18, 0.32], [0.18, 0.32], [-0.18, 0.68], [0.18, 0.68]]) box(g, 0.025, 0.42, 0.025, x + dx, 0, z + dz, 0x707070);
}
function buildRoom(key: string): any {
  const g = new THREE.Group();
  if (key === "classroom") {
    shell(g, 9, 3, 8);
    box(g, 4, 1.2, 0.05, 0, 0.9, -6.92, 0x2f5a46);
    box(g, 4.2, 0.08, 0.15, 0, 0.82, -6.86, 0x8b6b4a);
    box(g, 1.6, 0.8, 0.6, -2.6, 0, -6.2, 0xb08860);
    for (let i = 0; i < 3; i++) windowOn(g, -1, -4.45, -1.2 - i * 2, 1.6, 1.5, 0.9);
    box(g, 0.05, 2.1, 0.9, 4.46, 0, -1.4, 0xa07850);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) desk(g, -3.2 + c * 1.6, -5 + r * 1.35);
  } else if (key === "bedroom") {
    shell(g, 4.5, 2.5, 4.5, 0xc9a77c, 0xeee5d8);
    box(g, 1.2, 0.45, 2.1, -1.5, 0, -2.4, 0xf0ece4); box(g, 1.2, 0.9, 0.08, -1.5, 0, -3.42, 0x9c7b5c);
    box(g, 0.6, 0.12, 0.4, -1.5, 0.45, -3.1, 0xffffff);
    box(g, 1.1, 0.04, 0.55, 1.6, 0.72, -3.1, 0xc49a6c); box(g, 1.1, 0.72, 0.04, 1.6, 0, -3.35, 0xb58a5c);
    box(g, 0.9, 2.0, 0.55, 1.75, 0, -1.2, 0xb08860);
    box(g, 1.3, 0.06, 0.1, -0.2, 0.84, -3.4, 0xf5f5f5); box(g, 1.3, 0.06, 0.1, -0.2, 2.1, -3.4, 0xf5f5f5);
    box(g, 1.2, 1.2, 0.05, -0.2, 0.9, -3.42, 0xbfd8e8);
    box(g, 1.6, 0.02, 1.1, 0, 0, -1.6, 0xd9b8b8);
  } else if (key === "corridor") {
    shell(g, 2.8, 2.9, 30, 0xb7b0a0, 0xe9e6dc);
    for (let i = 0; i < 6; i++) {
      box(g, 0.06, 2.1, 1.0, -1.37, 0, -2 - i * 4.5, 0xa07850);
      windowOn(g, 1, 1.4, -2.5 - i * 4.5, 2.4, 1.3, 1.0);
    }
    for (let i = 0; i < 10; i++) box(g, 0.45, 1.8, 0.5, -1.15, 0, -4 - i * 0.5 - Math.floor(i / 5) * 6, 0x8a9aa6);
  } else if (key === "street") {
    box(g, 8, 0.02, 80, 0, -0.02, -30, 0x6e6e70);
    for (const s of [-1, 1]) {
      box(g, 3, 0.15, 80, s * 5.5, 0, -30, 0xbdb6aa);
      for (let i = 0; i < 9; i++) {
        const hgt = 6 + ((i * 7 + (s > 0 ? 3 : 0)) % 5) * 2.2, d = 6 + (i % 3) * 1.5;
        const b = box(g, 6, hgt, d - 0.3, s * 10, 0, 6 - i * 8.5, [0xd8cfc0, 0xc8c2b8, 0xe2d6c6][i % 3]);
        for (let f = 1; f < hgt / 3; f++) for (let k = -1; k <= 1; k++) box(g, 0.05, 1.1, 1.0, s * 6.98, f * 3 - 1.6, 6 - i * 8.5 + k * (d / 3), 0x9cb4c4);
        void b;
      }
      for (let i = 0; i < 6; i++) cyl(g, 0.07, 5.5, s * 4.4, 0.15, 4 - i * 14);
    }
    for (let i = 0; i < 20; i++) box(g, 0.15, 0.01, 2.5, 0, 0, 6 - i * 5, 0xf2f2f2);
  } else if (key === "cafe") {
    shell(g, 8, 3, 7, 0x8c6a4c, 0xece0cc);
    box(g, 3.2, 1.05, 0.6, 1.8, 0, -5.4, 0x7a5236); box(g, 3.2, 0.05, 0.7, 1.8, 1.05, -5.4, 0x5a3a26);
    for (let i = 0; i < 4; i++) box(g, 0.8, 0.05, 0.35, 1.8 + (i - 1.5) * 0.85, 1.75, -5.9, 0x6a4a32);
    for (const [x, z] of [[-2.4, -1.5], [-2.4, -3.5], [-0.2, -2.2], [-0.2, -4.2]]) {
      cyl(g, 0.4, 0.03, x, 0.72, z, 0xe8e2d6); cyl(g, 0.04, 0.72, x, 0, z, 0x404040);
      for (const dx of [-0.6, 0.6]) { box(g, 0.4, 0.04, 0.4, x + dx, 0.45, z, 0x5a3a26); box(g, 0.04, 0.45, 0.4, x + dx * 1.3, 0.45, z, 0x5a3a26); }
    }
    for (let i = 0; i < 3; i++) windowOn(g, -1, -3.95, -1 - i * 2, 1.6, 1.8, 0.6);
  } else if (key === "rooftop") {
    box(g, 14, 0.02, 14, 0, -0.02, -5, 0xa8a49a);
    for (const [w, d, x, z] of [[14, 0.1, 0, -12], [0.1, 14, -7, -5], [0.1, 14, 7, -5]] as number[][]) {
      box(g, w, 0.05, d, x, 1.2, z, 0x9aa0a6);
      const n = Math.round(Math.max(w, d) / 0.6);
      for (let i = 0; i <= n; i++) w > d ? box(g, 0.03, 1.2, 0.03, x - w / 2 + i * w / n, 0, z, 0x9aa0a6) : box(g, 0.03, 1.2, 0.03, x, 0, z - d / 2 + i * d / n, 0x9aa0a6);
    }
    box(g, 2.6, 2.6, 2.4, 4.6, 0, -9, 0xd4cec4); box(g, 0.9, 2.1, 0.05, 4.2, 0, -7.78, 0x7a8288);
    box(g, 1.6, 1.4, 1.2, -5, 0, -10, 0xb8bcc0);
  }
  if (key === "empty" || key === "model") {
    const grid = new THREE.GridHelper(40, 40, 0x777777, 0x555555); grid.userData.noDepth = true; g.add(grid);
  }
  return g;
}
async function loadModel(ref: string): Promise<any> {
  if (T.models.has(ref)) return T.models.get(ref).clone();
  const gltf = await new GLTF().loadAsync(`/model?ref=${encodeURIComponent(ref)}`);
  const root = gltf.scene;
  root.traverse((o: any) => { if (o.isMesh && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m: any) => { m.side = THREE.DoubleSide; }); } });
  T.models.set(ref, root);
  return root.clone();
}
let building: string | null = null;
async function syncRoom(b: Bg3D) {
  const key = b.room === "model" ? "model:" + (b.model || "") : b.room;
  if (T.roomKey === key || building === key) return T.roomKey === key;
  building = key;
  try {
    const g = buildRoom(b.room === "model" ? "model" : b.room);
    if (b.room === "model" && b.model) g.add(await loadModel(b.model));
    if (T.room) { T.scene.remove(T.room); T.room.traverse((o: any) => { if (o.userData.edges) o.userData.edges.geometry.dispose(); }); }
    g.traverse((o: any) => {
      if (!o.isMesh) return;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 28), new THREE.LineBasicMaterial({ color: 0xffffff }));
      e.visible = false; o.add(e); o.userData.edges = e;
    });
    T.room = g; T.scene.add(g); T.roomKey = key;
  } catch (e: any) { toast("Could not load the 3D model: " + e.message, "err"); }
  finally { building = null; }
  return true;
}
function setCamera(b: Bg3D, w: number, h: number) {
  const c = T.cam, cam = b.cam;
  c.aspect = w / h; c.setFocalLength(cam.focal); c.position.set(cam.x, cam.y, cam.z);
  c.rotation.set(cam.pitch * Math.PI / 180, cam.yaw * Math.PI / 180, 0); c.updateProjectionMatrix(); c.updateMatrixWorld();
  if (T.renderer.domElement.width !== w || T.renderer.domElement.height !== h) T.renderer.setSize(w, h, false);
}

/* the shaded room under the figures; null until three.js and the room are ready */
export function preview(redraw: () => void): HTMLCanvasElement | null {
  const b = bg(); if (!b) return null;
  if (!THREE) { load3D(redraw); return null; }
  const { w, h } = P.scene, key = JSON.stringify([b.room, b.model, b.cam, w, h]);
  if (key === T.previewKey && T.preview) return T.preview;
  syncRoom(b).then(ok => { if (ok === false || T.roomKey !== (b.room === "model" ? "model:" + (b.model || "") : b.room)) return; redraw(); });
  if (T.roomKey !== (b.room === "model" ? "model:" + (b.model || "") : b.room)) return T.preview;
  setCamera(b, w, h);
  T.scene.background = new THREE.Color(0x9fb3c8); T.figs.visible = false;
  T.renderer.render(T.scene, T.cam);
  const out = T.preview && T.preview.width === w && T.preview.height === h ? T.preview : Object.assign(document.createElement("canvas"), { width: w, height: h });
  out.getContext("2d").drawImage(T.renderer.domElement, 0, 0);
  T.preview = out; T.previewKey = key;
  return out;
}

/* ---------------------------------------------------------------- figures as volumes (depth only) */
function buildFigures(b: Bg3D) {
  T.figs.clear();
  const { w, h } = P.scene, m = new THREE.MeshBasicMaterial();
  const limb = (a: number[], c: number[], r: number) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...c), len = A.distanceTo(B); if (len < 1e-3) return;
    const g = new THREE.CapsuleGeometry(r, len, 4, 10), mesh = new THREE.Mesh(g, m);
    mesh.position.copy(A).add(B).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    T.figs.add(mesh);
  };
  for (const c of P.scene.chars as any[]) {
    if (c.hidden) continue;
    const pr = project(c, w, h); if (!pr) continue;
    const d0 = floorDepth(b.cam, w, h, c.x * w, c.y * h) ?? pxPerMetre(b.cam, w, h, 1) / pr.k;
    const s = pr.k / pxPerMetre(b.cam, w, h, d0);                         // pose units -> metres at this depth
    const at = (p: number[]) => toWorld(b.cam, w, h, p[0], p[1], Math.max(0.1, d0 - (p[2] || 0) * s));
    const J = pr.body.map(at), miss = pr.miss as Set<number>, has = (i: number) => !miss.has(i);
    for (const [a, q] of LIMBS) if (has(a) && has(q) && !(a === 0 || q === 0) && a !== 14 && a !== 15) limb(J[a], J[q], 0.055 * s);
    if (has(1) && has(8) && has(11)) {                                    // torso
      limb(J[1], J[8], 0.09 * s); limb(J[1], J[11], 0.09 * s);
      const hip = J[8].map((v: number, i: number) => (v + J[11][i]) / 2); limb(J[1], hip, 0.1 * s);
    }
    const head = has(16) && has(17) ? J[16].map((v: number, i: number) => (v + J[17][i]) / 2) : has(0) ? J[0] : null;
    if (head) { const sp = new THREE.Mesh(new THREE.SphereGeometry(0.115 * s, 16, 12), m); sp.position.set(...head); T.figs.add(sp); }
  }
}

/* ---------------------------------------------------------------- the ControlNet passes */
const DEPTH_VS = "varying float vz; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vz = -mv.z; gl_Position = projectionMatrix * mv; }";
function depthMaterial(near: number, far: number, linear: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: { near: { value: near }, far: { value: far } }, vertexShader: DEPTH_VS, side: THREE.DoubleSide,
    fragmentShader: linear
      ? "uniform float near; uniform float far; varying float vz; void main(){ float v = min(sqrt(vz / far), 0.996); gl_FragColor = vec4(v, v, v, 1.0); }"
      : "uniform float near; uniform float far; varying float vz; void main(){ float v = clamp((1.0/vz - 1.0/far) / (1.0/near - 1.0/far), 0.0, 1.0); gl_FragColor = vec4(v, v, v, 1.0); }",
  });
}
function grab(w: number, h: number) {
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  c.getContext("2d")!.drawImage(T.renderer.domElement, 0, 0); return c;
}
function hideHelpers(on: boolean) { T.room?.traverse((o: any) => { if (o.userData.noDepth) o.visible = !on; }); }
/* depth.png: near is white, the far wall dark, nothing (sky) black; the range is the scene's own */
function renderDepth(b: Bg3D, withFigures: boolean): HTMLCanvasElement {
  const { w, h } = P.scene, r = T.renderer;
  T.figs.visible = withFigures; hideHelpers(true);
  T.scene.background = new THREE.Color(0xffffff);
  const FAR = 400; T.scene.overrideMaterial = depthMaterial(0.05, FAR, true);
  r.render(T.scene, T.cam);
  const gl = r.getContext(), px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const hist = new Uint32Array(256); let n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] < 255) { hist[px[i]]++; n++; }
  const pct = (q: number) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * n) return v; } return 254; };
  // the nearest few percent (a desk edge at the lens) must not push the rest of the room into black
  const dep = (v: number) => (v / 255) ** 2 * FAR;      // the first pass stores sqrt(depth / FAR)
  const near = Math.max(0.3, dep(pct(0.03) + 0.5)), far = Math.max(near + 1, dep(pct(0.995) + 1) * 1.1);
  T.scene.background = new THREE.Color(0x000000);
  T.scene.overrideMaterial = depthMaterial(near, far, false);
  r.render(T.scene, T.cam);
  T.scene.overrideMaterial = null; T.figs.visible = false; hideHelpers(false);
  return grab(w, h);
}
/* lines.png: the room's edges in white on black, hidden where a figure stands in front */
function renderLines(): HTMLCanvasElement {
  const { w, h } = P.scene, r = T.renderer, black = new THREE.MeshBasicMaterial({ color: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4, side: THREE.DoubleSide });
  const saved: [any, any][] = [];
  T.scene.traverse((o: any) => { if (o.isMesh) { saved.push([o, o.material]); o.material = black; } });
  T.room.traverse((o: any) => { if (o.userData.edges) o.userData.edges.visible = true; });
  hideHelpers(true); T.figs.visible = true;
  T.scene.background = new THREE.Color(0x000000);
  r.render(T.scene, T.cam);
  saved.forEach(([o, m]) => { o.material = m; });
  T.room.traverse((o: any) => { if (o.userData.edges) o.userData.edges.visible = false; });
  hideHelpers(false); T.figs.visible = false;
  return grab(w, h);
}
/* what "Save to shot" sends: the two passes (data URLs) and the vanishing points for page rulers */
export async function scenePasses(opt: { figures?: boolean } = {}): Promise<{ depth: string; lines: string | null; vps: any; dirs: number[] } | null> {
  const b = bg(); if (!b) return null;
  await load3D(); await syncRoom(b);
  const { w, h } = P.scene;
  setCamera(b, w, h);
  if (opt.figures !== false) buildFigures(b); else T.figs.clear();
  const depth = renderDepth(b, opt.figures !== false).toDataURL("image/png");
  const lines = b.lines ? renderLines().toDataURL("image/png") : null;
  T.previewKey = "";
  const v = vanishing(b.cam, w, h);
  return { depth, lines, vps: v.vps, dirs: v.dirs };
}

/* ---------------------------------------------------------------- imported models */
export async function importModel(f: File): Promise<{ ref: string; name: string } | null> {
  if (!/\.glb$/i.test(f.name)) { toast("Import a glTF binary (.glb). Export one from Blender: File > Export > glTF 2.0, format .glb", "err"); return null; }
  try { return await post(`/api/scene3d/upload?name=${encodeURIComponent(f.name)}`, f, true); }
  catch (e: any) { toast(e.message, "err"); return null; }
}
export const listModels = (): Promise<{ ref: string; name: string }[]> => api("/api/scene3d/models").catch(() => []);
export { ROOM_CAM };
