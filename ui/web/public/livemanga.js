/* livemanga.js: reference player for the Live Manga format 1.0 (docs/LIVEMANGA_FORMAT.md).
   One file, no dependencies. Draws a page's still, plays its moving panels (a background plus cut-out
   characters warped along baked skeletons) and lays the lettering overlay on top.

     LiveManga.reader(element, "chapter1/manga.json")         a page-at-a-time reader
     LiveManga.page(canvas, manifest, pageIndex, baseUrl)      one page in your own canvas -> { stop() }

   The MangaMaker editor (ui/web/src/editor/live.js) uses the same rig code for its Live Manga preview. */
(function (root) {
  "use strict";

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // COCO-18 bones that carry a cutout: head, shoulders, arms, torso sides, legs, hips
  const BONES = [[1, 0], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [8, 11]];

  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
    const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2, 0, 1);
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }

  /* A grid mesh over the image's opaque area; every vertex bound to its three nearest bones.
     `bind` = the 18 skeleton points (image pixels) the image was drawn in. */
  function buildRig(img, bind) {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    let a;
    try { a = g.getImageData(0, 0, W, H).data; } catch (e) { return null; }      // cross-origin image without CORS
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (a[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) return null;
    const bones = BONES.map(([s, e], k) => [s, e, k]).filter(([s, e]) => bind[s] && bind[e]);
    if (!bones.length) return null;
    const cell = Math.max(6, Math.round((y1 - y0) / 48));
    x0 = Math.max(0, x0 - cell); y0 = Math.max(0, y0 - cell); x1 = Math.min(W, x1 + cell); y1 = Math.min(H, y1 + cell);
    const nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1;
    const verts = [], tris = [];
    const solid = (x, y) => { x = clamp(Math.round(x), 0, W - 1); y = clamp(Math.round(y), 0, H - 1); return a[(y * W + x) * 4 + 3] > 8; };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const p = [x0 + i * cell, y0 + j * cell];
      const d = bones.map(([s, e, k]) => [segDist(p, bind[s], bind[e]), k]).sort((m, n) => m[0] - n[0]).slice(0, 3);
      let ws = d.map(([dd]) => 1 / Math.pow(dd + cell * 0.5, 4)); const sum = ws.reduce((m, n) => m + n, 0); ws = ws.map(w => w / sum);
      verts.push({ p, w: d.map(([, k], n) => [k, ws[n]]) });
    }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const q = [j * nx + i, j * nx + i + 1, (j + 1) * nx + i + 1, (j + 1) * nx + i];
      const cx = x0 + (i + 0.5) * cell, cy = y0 + (j + 0.5) * cell;
      let any = false;                                        // empty cells are skipped (fewer triangles, no smear)
      for (const [ox, oy] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) if (solid(cx + ox * cell, cy + oy * cell)) { any = true; break; }
      if (any) tris.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
    }
    return { img, verts, tris, bind };
  }

  /* each bone moves its vertices with the map that turns the bound bone onto the posed one and
     stretches along its length only (a foreshortened limb gets shorter, not thinner) */
  function boneMaps(bind, cur) {
    return BONES.map(([s, e]) => {
      const A = bind[s], B = bind[e];
      if (!A || !B) return p => p;
      const A2 = cur[s] || A, B2 = cur[e] || B;
      const dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1e-9, ux = dx / l, uy = dy / l;
      const dx2 = B2[0] - A2[0], dy2 = B2[1] - A2[1], l2 = Math.hypot(dx2, dy2) || 1e-9, vx = dx2 / l2, vy = dy2 / l2;
      const st = clamp(l2 / l, 0.35, 2.5);
      return p => { const rx = p[0] - A[0], ry = p[1] - A[1], al = (rx * ux + ry * uy) * st, pe = -rx * uy + ry * ux; return [A2[0] + al * vx - pe * vy, A2[1] + al * vy + pe * vx]; };
    });
  }
  function drawRig(g, rig, cur) {
    const maps = boneMaps(rig.bind, cur);
    const out = rig.verts.map(v => { let x = 0, y = 0; for (const [k, w] of v.w) { const q = maps[k](v.p); x += q[0] * w; y += q[1] * w; } return [x, y]; });
    for (const t of rig.tris) {
      const [s0, s1, s2] = t.map(i => rig.verts[i].p), [d0, d1, d2] = t.map(i => out[i]);
      const mx = (d0[0] + d1[0] + d2[0]) / 3, my = (d0[1] + d1[1] + d2[1]) / 3;
      const grow = p => { const dx = p[0] - mx, dy = p[1] - my, l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.7, p[1] + dy / l * 0.7]; };
      const e0 = grow(d0), e1 = grow(d1), e2 = grow(d2);       // overlap neighbours by a hair: no seams
      const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
      if (!den) continue;
      const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / den;
      const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / den;
      const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / den;
      const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / den;
      const e = d0[0] - a * s0[0] - c * s0[1], f = d0[1] - b * s0[0] - d * s0[1];
      g.save();
      g.beginPath(); g.moveTo(e0[0], e0[1]); g.lineTo(e1[0], e1[1]); g.lineTo(e2[0], e2[1]); g.closePath(); g.clip();
      g.transform(a, b, c, d, e, f);
      g.drawImage(rig.img, 0, 0);
      g.restore();
    }
  }

  /* ------------------------------------------------------------------ validation */
  /* A manifest is untrusted input: it may come from any site. Everything the player uses is checked
     and copied into a fresh object; anything else in the file is ignored. */
  const LIMITS = { manifestBytes: 16 << 20, pages: 2000, pageSide: 8192, artSide: 4096, panels: 32, actors: 16,
    frames: 1440, fps: 60, imagePixels: 4096 * 4096 * 1.5, title: 200, path: 256 };
  const VALID = new WeakSet();
  const fail = (where, what) => { throw new Error(`Live Manga manifest: ${where} ${what}`); };
  const num = (v, where, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi) ? v : fail(where, `must be a number from ${lo} to ${hi}`);
  const int = (v, where, lo, hi) => Number.isInteger(v) ? num(v, where, lo, hi) : fail(where, "must be a whole number");
  const arr = (v, where, max) => Array.isArray(v) && v.length <= max ? v : fail(where, `must be a list of at most ${max}`);
  // bundle-relative paths only: no scheme, no leading slash, no "." or ".." segments
  function relPath(v, where) {
    if (typeof v !== "string" || !v || v.length > LIMITS.path || !/^[A-Za-z0-9_][A-Za-z0-9_.\/-]*$/.test(v) ||
        v.split("/").some(seg => !seg || seg === "." || seg === "..")) fail(where, "must be a relative path inside the bundle");
    return v;
  }
  function skeleton(v, where, side) {
    arr(v, where, 18);
    if (v.length !== 18) fail(where, "must have 18 points");
    return v.map((p, k) => p === null ? null : (arr(p, `${where}[${k}]`, 2).length === 2
      ? [num(p[0], `${where}[${k}]`, -4 * side, 5 * side), num(p[1], `${where}[${k}]`, -4 * side, 5 * side)] : fail(`${where}[${k}]`, "must be [x, y]")));
  }
  function validate(m) {
    if (!m || typeof m !== "object") fail("", "is not an object");
    if (m.format !== "livemanga") fail("format", 'must be "livemanga"');
    if (!/^1\.\d+$/.test(String(m.version))) fail("version", `${String(m.version).slice(0, 20)} is not supported by this player (1.x)`);
    const W = int(m.page?.width, "page.width", 64, LIMITS.pageSide), H = int(m.page?.height, "page.height", 64, LIMITS.pageSide);
    const out = { format: "livemanga", version: String(m.version), title: typeof m.title === "string" ? m.title.slice(0, LIMITS.title) : "",
      reading: m.reading === "ltr" ? "ltr" : "rtl", page: { width: W, height: H }, pages: [] };
    arr(m.pages, "pages", LIMITS.pages).forEach((pg, i) => {
      const w = `pages[${i}]`;
      if (!pg || typeof pg !== "object") fail(w, "is not an object");
      const po = { base: relPath(pg.base, w + ".base"), overlay: pg.overlay == null ? null : relPath(pg.overlay, w + ".overlay"), panels: [] };
      arr(pg.panels || [], w + ".panels", LIMITS.panels).forEach((p, j) => {
        const pw = `${w}.panels[${j}]`;
        const aw = int(p?.art?.width, pw + ".art.width", 16, LIMITS.artSide), ah = int(p?.art?.height, pw + ".art.height", 16, LIMITS.artSide);
        const box = (v, where, lo, hi) => { arr(v, where, 4); if (v.length !== 4) fail(where, "must be [x, y, w, h]"); return v.map(n => num(n, where, lo, hi)); };
        const panel = {
          id: typeof p.id === "string" ? p.id.slice(0, 64) : String(j),
          clip: box(p.clip, pw + ".clip", -LIMITS.pageSide, 2 * LIMITS.pageSide),
          art: { width: aw, height: ah, rect: box(p.art.rect, pw + ".art.rect", -4 * LIMITS.pageSide, 8 * LIMITS.pageSide), flip: p.art.flip === true },
          fps: num(p.fps ?? 12, pw + ".fps", 1, LIMITS.fps), loop: p.loop === "once" ? "once" : "loop",
          background: relPath(p.background, pw + ".background"), actors: [],
        };
        const side = Math.max(aw, ah);
        arr(p.actors, pw + ".actors", LIMITS.actors).forEach((a, k) => {
          const ak = `${pw}.actors[${k}]`;
          panel.actors.push({ image: relPath(a?.image, ak + ".image"), bind: skeleton(a.bind, ak + ".bind", side),
            frames: arr(a.frames, ak + ".frames", LIMITS.frames).map((f, n) => skeleton(f, `${ak}.frames[${n}]`, side)) });
        });
        po.panels.push(panel);
      });
      out.pages.push(po);
    });
    if (!out.pages.length) fail("pages", "is empty");
    VALID.add(out);
    return out;
  }
  /* an asset URL must stay inside the manifest's own folder (same origin, same path prefix) */
  function resolve(base, p) {
    if (p == null) return null;
    const u = new URL(relPath(p, "asset"), base), dir = new URL(".", base);
    if (u.origin !== dir.origin || !u.pathname.startsWith(dir.pathname)) fail("asset", "points outside the bundle");
    return u.href;
  }

  /* ------------------------------------------------------------------ loading */
  function loadImage(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = "anonymous";                  // rigs read pixels: hosts on another origin need CORS
      im.referrerPolicy = "no-referrer";             // the reader page's address is not sent to the image host
      im.decoding = "async";
      im.onload = () => im.naturalWidth * im.naturalHeight > LIMITS.imagePixels ? rej(new Error("image too large: " + url)) : res(im);
      im.onerror = () => rej(new Error("could not load " + url));
      im.src = url;
    });
  }
  async function loadManifest(url) {
    const r = await fetch(url, { credentials: "same-origin", referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    if (+(r.headers.get("Content-Length") || 0) > LIMITS.manifestBytes) throw new Error(`${url}: manifest too large`);
    const text = await r.text();
    if (text.length > LIMITS.manifestBytes) throw new Error(`${url}: manifest too large`);
    return validate(JSON.parse(text));
  }
  const reducedMotion = () => root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------ one page */
  function page(canvas, man, index, baseUrl, opt = {}) {
    if (!VALID.has(man)) man = validate(man);
    const pg = man.pages[clamp(index | 0, 0, man.pages.length - 1)], W = man.page.width, H = man.page.height;
    const g = canvas.getContext("2d");
    let alive = true, raf = 0, visible = true, last = "";
    const st = { base: null, overlay: null, panels: [] };
    const fit = () => {
      const css = canvas.clientWidth || W, s = Math.min(1, css * (root.devicePixelRatio || 1) / W) || 1;
      const w = Math.round(W * s), h = Math.round(H * s);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; last = ""; }
      return s;
    };
    const draw = force => {
      if (!st.base) return;
      const now = performance.now() / 1000;
      const frames = st.panels.map(p => {
        const n = p.count;
        if (!n || opt.still) return 0;
        const f = Math.floor((now - p.t0) * p.fps);
        return p.loop === "once" ? Math.min(f, n - 1) : ((f % n) + n) % n;
      });
      const key = frames.join(",") + "|" + canvas.width;
      if (!force && key === last) return;
      last = key;
      const s = fit();
      g.setTransform(s, 0, 0, s, 0, 0);
      g.drawImage(st.base, 0, 0, W, H);
      st.panels.forEach((p, i) => {
        if (!p.ready) return;
        const off = p.off, og = off.getContext("2d");
        og.setTransform(1, 0, 0, 1, 0, 0); og.clearRect(0, 0, off.width, off.height);
        og.drawImage(p.bg, 0, 0, off.width, off.height);
        for (const a of p.actors) if (a.rig) drawRig(og, a.rig, a.frames[Math.min(frames[i], a.frames.length - 1)] || a.bind);
        const [cx, cy, cw, ch] = p.clip, [rx, ry, rw, rh] = p.art.rect;
        g.save(); g.beginPath(); g.rect(cx, cy, cw, ch); g.clip();
        if (p.art.flip) { g.translate(rx + rw, ry); g.scale(-1, 1); g.drawImage(off, 0, 0, rw, rh); }
        else g.drawImage(off, rx, ry, rw, rh);
        g.restore();
      });
      if (st.overlay) g.drawImage(st.overlay, 0, 0, W, H);
    };
    const loop = () => { if (!alive) return; if (visible) draw(false); raf = requestAnimationFrame(loop); };
    (async () => {
      st.base = await loadImage(resolve(baseUrl, pg.base));
      if (pg.overlay) st.overlay = await loadImage(resolve(baseUrl, pg.overlay)).catch(() => null);
      draw(true);
      if (opt.still || reducedMotion()) return;                // the still page is the whole manga
      const t0 = performance.now() / 1000;
      st.panels = pg.panels.map(p => ({ ...p, src: p.actors, t0, ready: false, actors: [], count: 0 }));
      await Promise.all(st.panels.map(async p => {
        try {
          p.bg = await loadImage(resolve(baseUrl, p.background));
          p.off = document.createElement("canvas"); p.off.width = p.art.width; p.off.height = p.art.height;
          p.actors = await Promise.all(p.src.map(async a => {
            const img = await loadImage(resolve(baseUrl, a.image));
            return { ...a, rig: buildRig(img, a.bind) };
          }));
          p.count = Math.max(1, ...p.actors.map(a => a.frames.length));
          p.ready = true;
        } catch (e) { console.warn("[livemanga] panel", p.id, e.message); }
      }));
      draw(true);
      if (root.IntersectionObserver) {
        const io = new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); });
        io.observe(canvas); st.io = io;
      }
      raf = requestAnimationFrame(loop);
    })().catch(e => console.warn("[livemanga]", e.message));
    return { stop() { alive = false; cancelAnimationFrame(raf); st.io?.disconnect(); }, redraw: () => draw(true) };
  }

  /* ------------------------------------------------------------------ reader */
  async function reader(el, url, opt = {}) {
    const man = await loadManifest(url);
    const base = new URL(url, root.location.href).href;
    const rtl = man.reading !== "ltr";
    el.classList.add("livemanga");
    el.style.position = el.style.position || "relative";
    const cv = document.createElement("canvas");
    Object.assign(cv.style, { display: "block", width: "100%", maxWidth: man.page.width + "px", aspectRatio: `${man.page.width} / ${man.page.height}`,
      margin: "0 auto", background: "#fff", touchAction: "pan-y" });
    const info = document.createElement("div");
    info.style.cssText = "text-align:center;font:13px/1.6 system-ui,sans-serif;opacity:.7;padding:6px";
    el.replaceChildren(cv, info);
    let i = clamp(opt.start || 0, 0, man.pages.length - 1), cur = null;
    const show = n => {
      i = clamp(n, 0, man.pages.length - 1);
      cur?.stop(); cur = page(cv, man, i, base, opt);
      info.textContent = `${man.title ? man.title + " · " : ""}${i + 1} / ${man.pages.length}`;
    };
    const next = () => show(i + 1), prev = () => show(i - 1);
    let swiped = false;
    cv.addEventListener("click", e => {                         // the reading direction decides which side turns forward
      if (swiped) { swiped = false; return; }
      const left = e.offsetX < cv.clientWidth / 2;
      (left === rtl ? next : prev)();
    });
    let sx = null;
    cv.addEventListener("pointerdown", e => { sx = e.clientX; });
    cv.addEventListener("pointerup", e => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50) { swiped = true; ((dx > 0) === rtl ? next : prev)(); } });
    const key = e => {
      if (!el.isConnected) return destroy();
      if (e.key === "ArrowLeft") (rtl ? next : prev)();
      if (e.key === "ArrowRight") (rtl ? prev : next)();
    };
    const resize = () => cur?.redraw();
    const destroy = () => { cur?.stop(); root.removeEventListener("keydown", key); root.removeEventListener("resize", resize); };
    root.addEventListener("keydown", key);
    root.addEventListener("resize", resize);
    show(i);
    return { manifest: man, show, next, prev, destroy, get index() { return i; } };
  }

  root.LiveManga = Object.freeze({ version: "1.0", LIMITS: Object.freeze({ ...LIMITS }), BONES, buildRig, drawRig, validate, loadManifest, page, reader });
})(typeof window !== "undefined" ? window : globalThis);
