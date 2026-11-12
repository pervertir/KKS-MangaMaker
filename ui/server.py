"""MangaMaker: a local page editor for MangaPipeline (http://127.0.0.1:8765).

Serves the built editor (ui/web/dist; source in ui/web), the shot renders and the Comics templates, and runs the
mangapipe commands (render on the pod, grab from Studio, pod start/stop) as background jobs.
Nothing renders on this Mac: `run`/`render` go to the pod configured in config.yaml.

    ./mangapipe-ui            (or: python ui/server.py [--port 8765])
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import subprocess
import sys
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent  # MangaPipeline/
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import yaml  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

from mp.compose import _interior_rect  # noqa: E402
from mp.config import Config  # noqa: E402
from mp.page import STRIPS_SUBDIR, detect_panels, find_render, load_script, reading_order, _shot_dir, _shot_dialogue  # noqa: E402
from mp.sidecar import SIDECAR_NAMES, write_example  # noqa: E402

WEB = Path(__file__).resolve().parent / "web"          # the editor's source (Vite project)
STATIC = WEB / "dist"                                  # what `npm run build` makes of it; this is what is served
CFG = Config()
TPL = CFG.templates_dir
CACHE = CFG.cache_dir / "ui"
CACHE.mkdir(parents=True, exist_ok=True)
SHOTS = ROOT / "shots"
PROJECTS = ROOT / "pages"
UPLOADS = ROOT / "assets" / "uploads"
PAGE_W, PAGE_H = 1800, 2700
ASSET_DIRS = {
    "decor": "Decorative Elements/Decorative-Elements-Images",
    "particles": "Particles",
    "speedlines": "SpeedLines",
}
NAME_RE = re.compile(r"^[A-Za-z0-9_\-. ]{1,80}$")


# ------------------------------------------------------------------------------ images
def resolve_ref(ref: str) -> Path:
    """`tpl:<rel>` (Comics templates), `mp:<rel>` (MangaPipeline/) or `cap:<rel>` (Studio captures).
    Refuses anything that escapes its root."""
    kind, _, rel = ref.partition(":")
    base = {"tpl": TPL, "mp": ROOT, "cap": CFG.cap_dir}.get(kind)
    if base is None or not rel:
        raise ValueError(f"bad image ref {ref!r}")
    p = (base / rel).resolve()
    if base.resolve() not in p.parents:
        raise ValueError(f"image ref outside its folder: {ref!r}")
    if not p.is_file():
        raise FileNotFoundError(ref)
    return p


def mp_ref(p: Path) -> str:
    return "mp:" + p.resolve().relative_to(ROOT).as_posix()


def sized(p: Path, w: int | None) -> tuple[bytes, str]:
    """The file itself, or a PNG/JPEG no wider than `w`, cached by path+mtime+w."""
    if not w:
        ctype = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
        return p.read_bytes(), ctype
    key = hashlib.sha1(f"{p}|{p.stat().st_mtime}|{w}".encode()).hexdigest()
    rgba = p.suffix.lower() == ".png"
    dest = CACHE / f"{key}.{'png' if rgba else 'jpg'}"
    if not dest.exists():
        im = Image.open(p)
        im.thumbnail((w, w * 4), Image.LANCZOS)
        if rgba:
            im.save(dest, optimize=False)
        else:
            im.convert("RGB").save(dest, quality=90)
    return dest.read_bytes(), "image/png" if rgba else "image/jpeg"


# ---------------------------------------------------------------------------- catalogs
_lock = threading.Lock()


def _cached_json(name: str, build):
    """Catalog built once per template folder (the key changes when templates_dir does)."""
    tag = hashlib.sha1(str(TPL.resolve()).encode()).hexdigest()[:8]
    with _lock:
        dest = CACHE / f"{Path(name).stem}_{tag}.json"
        if dest.exists():
            return json.loads(dest.read_text())
        data = build()
        dest.write_text(json.dumps(data))
        return data


def bubbles() -> list[dict]:
    """Every speech-bubble template with its text box (fractions of the bubble) and darkness."""
    def build():
        out = []
        for p in sorted(CFG.bubbles_dir.glob("*.png")):
            num = re.sub(r"\D", "", p.stem.rsplit("-", 1)[-1])
            im = Image.open(p).convert("RGBA")
            W, H = im.size
            small = im.copy()
            small.thumbnail((500, 500), Image.LANCZOS)
            a = np.array(small.getchannel("A"))
            x0, y0, x1, y1 = _interior_rect(a)
            sw, sh = small.size
            rgb = np.array(small.convert("RGB"))[y0:y1, x0:x1]
            lum = float(rgb.mean()) if rgb.size else 255.0
            out.append({"key": num.zfill(3), "ref": "tpl:" + p.relative_to(TPL).as_posix(), "w": W, "h": H,
                        "box": [x0 / sw, y0 / sh, x1 / sw, y1 / sh], "dark": lum < 110})
        return out
    return _cached_json("bubbles.json", build)


def layouts() -> list[dict]:
    """The 100 Comic Strips templates: panel rects in page pixels, natural (top-left) order."""
    def build():
        d = TPL / STRIPS_SUBDIR
        temps = sorted(d.glob("Template-*.png"), key=lambda p: int(p.stem.split("-")[1]))
        out = []
        for p in temps:
            bg = Image.open(p).convert("RGB")
            sx, sy = PAGE_W / bg.width, PAGE_H / bg.height
            rects = [[round(x * sx), round(y * sy), round(w * sx), round(h * sy)] for x, y, w, h in detect_panels(bg)]
            out.append({"n": int(p.stem.split("-")[1]), "ref": "tpl:" + p.relative_to(TPL).as_posix(), "rects": rects})
        return out
    return _cached_json("layouts.json", build)


def assets() -> dict:
    out = {}
    for cat, rel in ASSET_DIRS.items():
        d = TPL / rel
        files = sorted([p for p in d.glob("*") if p.suffix.lower() in (".png", ".jpg", ".jpeg")]) if d.exists() else []
        out[cat] = [{"ref": "tpl:" + p.relative_to(TPL).as_posix(), "name": p.stem, "multiply": p.suffix.lower() != ".png"} for p in files]
    UPLOADS.mkdir(parents=True, exist_ok=True)
    out["uploads"] = [{"ref": mp_ref(p), "name": p.stem, "multiply": False}
                      for p in sorted(UPLOADS.glob("*")) if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")]
    return out


def shots() -> list[dict]:
    out = []
    if not SHOTS.exists():
        return out
    for d in sorted(p for p in SHOTS.iterdir() if p.is_dir()):
        side = next((d / n for n in SIDECAR_NAMES if (d / n).exists()), None)
        o = d / "out"
        by_time = lambda pat: sorted(o.glob(pat), key=lambda f: f.stat().st_mtime, reverse=True) if o.exists() else []
        out.append({
            "name": d.name,
            "sidecar": side.name if side else None,
            "yaml": side.read_text(encoding="utf-8") if side else "",
            "pose": mp_ref(d / "pose.png") if (d / "pose.png").exists() else None,
            "reference": mp_ref(d / "reference.png") if (d / "reference.png").exists() else None,
            "scene": (d / "pose_scene.json").exists(),
            "renders": [mp_ref(f) for f in by_time("render_*.png")],
            "finals": [mp_ref(f) for f in by_time("final_*.png")],
        })
    return out


POSES = ROOT / "poses"
CAST = ROOT / "cast.json"   # the character sheet: reused across shots and projects


def pose_library() -> dict:
    """Built-in basics + the converted studio library (built on first use when the install is
    reachable) + poses saved from the editor."""
    from mp.kkpose import basic_poses, build_library
    lib = POSES / "library.json"
    if not lib.exists() and CFG.studio_pose_dir.is_dir():
        build_library(CFG.studio_pose_dir, lib)
    poses = basic_poses()
    hlib = POSES / "h_library.json"
    if not hlib.exists() and CFG.h_anim_dir.is_dir():
        try:   # needs UnityPy; without it the H positions are simply not offered
            from mp.khanim import build_h_library
            build_h_library(CFG.h_anim_dir, hlib)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"[ui] H-scene poses not built: {e}\n")
    hmods = POSES / "h_mods_library.json"
    if not hmods.exists() and CFG.h_mods_dir.is_dir():
        try:
            from mp.khanim import build_mod_library
            build_mod_library(CFG.h_mods_dir, hmods)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"[ui] mod H positions not built: {e}\n")
    for f in (lib, hlib, hmods, POSES / "custom.json"):
        if f.exists():
            poses += json.loads(f.read_text(encoding="utf-8")).get("poses", [])
    from mp.kkpose import KINDS, pose_kind
    for p in poses:
        p.pop("feet", None)   # not drawn by the editor
    for p in poses:   # older libraries and saved poses get a type too
        if not p.get("kind") and p.get("body"):
            p["kind"] = pose_kind(p, " ".join([p.get("group", ""), p.get("name", "")]))
    from mp.khanim import CATEGORIES
    adult = list(dict.fromkeys(CATEGORIES.values()))
    return {"poses": poses, "kinds": ["Group poses", *KINDS, *adult]}


def save_custom_pose(pose: dict) -> dict:
    f = POSES / "custom.json"
    data = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"version": 1, "poses": []}
    name = str(pose.get("name") or "My pose").strip()[:80]
    pid = "custom/" + re.sub(r"[^A-Za-z0-9_\-]+", "_", name) + "_" + uuid.uuid4().hex[:6]
    entry = {"id": pid, "name": name, "pack": "My poses", "group": "",
             **{k: pose[k] for k in ("body", "hands", "feet") if k in pose}}
    from mp.kkpose import pose_kind
    if pose.get("members"):   # a group pose: several figures with their places on the canvas
        keep = ("body", "hands", "x", "y", "scale", "z", "label", "gender")
        entry.update(id=pid.replace("custom/", "group/", 1), kind="Group poses", aspect=float(pose.get("aspect") or 0.7),
                     members=[{k: m[k] for k in keep if k in m} for m in pose["members"] if m.get("body")])
    else:
        entry["kind"] = pose.get("kind") or pose_kind(entry, name)
    data["poses"].append(entry)
    POSES.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return entry


def save_upload(fname: str, data: bytes) -> Path:
    fname = Path(fname).name
    stem, ext = Path(fname).stem, Path(fname).suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        raise ValueError("png, jpg or webp only")
    UPLOADS.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^A-Za-z0-9_\-]", "_", stem)[:60] or "upload"
    dest, k = UPLOADS / f"{stem}{ext}", 1
    while dest.exists():
        dest, k = UPLOADS / f"{stem}_{k}{ext}", k + 1
    dest.write_bytes(data)
    return dest


def detect_poses(fname: str, data: bytes) -> dict:
    """Pose tab › From image: DWPose on the pod finds every person; each becomes a saved pose (My poses)
    plus its place in the picture. The image is kept in uploads so the editor can show it as a guide."""
    from mp.comfy_client import Comfy
    from mp.kkpose import pose_kind
    from mp.posedetect import poses_from_image
    img = save_upload(fname, data)
    comfy = Comfy(CFG.comfy_url, lambda m: sys.stderr.write(m + "\n"))
    if not comfy.alive():
        raise RuntimeError("the pod's ComfyUI is not answering: start the pod (pod pill › Start pod) and try again")
    res = poses_from_image(comfy, img)
    out = []
    for i, p in enumerate(res["people"], 1):
        e = save_custom_pose({"name": f"{img.stem} #{i}", "body": p["body"], "hands": p["hands"]})
        e["kind"] = e.get("kind") or pose_kind(e, "")
        out.append({"pose": e, "place": p["place"]})
    return {"guide": mp_ref(img), "w": res["w"], "h": res["h"], "people": out}


def save_pose_shot(body: dict) -> dict:
    """Pose studio -> shot folder: pose.png (OpenPose skeletons on black), pose_scene.json (the editable
    scene) and the sidecar's characters/prompt, so `run` renders it with no Studio capture at all."""
    import base64
    d = shot_dir(body["name"], must_exist=False)
    chars = body.get("characters") or [{"name": "", "series": ""}]
    side = next((d / n for n in SIDECAR_NAMES if (d / n).exists()), None)
    if side is None:
        side = write_example(d, str(chars[0]["name"]).strip(), str(chars[0].get("series", "")).strip())
        text = side.read_text(encoding="utf-8")
        text = text.replace("reference: reference.png    # optional: F11 render of the real character, same camera\n", "")
        text = text.replace('  - text: "Replace me."\n    bubble: "001"\n    at: [0.70, 0.12]\n    size: 0.40\n    flip: false\n', "  []\n")
        text = text.replace("dialogue:\n  []", "dialogue: []    # the editor letters the page; add lines here for `mangapipe compose`")
        side.write_text(text, encoding="utf-8")
    text = side.read_text(encoding="utf-8")
    if side.suffix != ".json":
        try:
            text = with_characters(text, chars)
        except ValueError:
            pass
        if body.get("prompt") is not None:
            line = "prompt: " + json.dumps(str(body["prompt"]), ensure_ascii=False)
            text = re.sub(r"(?m)^prompt:.*$", lambda m: line, text) if re.search(r"(?m)^prompt:", text) else text + line + "\n"
        side.write_text(text, encoding="utf-8")
    if body.get("count_tag") and side.suffix != ".json":
        t = side.read_text(encoding="utf-8")
        line = "count_tag: " + json.dumps(str(body["count_tag"]))
        t = re.sub(r"(?m)^count_tag:.*$", lambda m: line, t) if re.search(r"(?m)^count_tag:", t) else t.replace("\nidentity:", "\n" + line + "\nidentity:", 1)
        side.write_text(t, encoding="utf-8")
    if isinstance(body.get("extra"), dict) and side.suffix != ".json":   # plain sidecar keys, e.g. head_inpaint: false
        t = side.read_text(encoding="utf-8")
        for k, v in body["extra"].items():
            if not re.fullmatch(r"[a-z_]{1,40}", str(k)):
                continue
            line = f"{k}: {json.dumps(v)}"
            t = re.sub(rf"(?m)^{k}:.*$", lambda m: line, t) if re.search(rf"(?m)^{k}:", t) else t.replace("\nidentity:", "\n" + line + "\nidentity:", 1)
        side.write_text(t, encoding="utf-8")
    apply_reference(d, chars)
    png = body["png"].split(",", 1)[-1]
    Image.open(io.BytesIO(base64.b64decode(png))).convert("RGB").save(d / "pose.png")
    (d / "pose_scene.json").write_text(json.dumps(body.get("scene") or {}, indent=1), encoding="utf-8")
    return {"ok": True, "pose": mp_ref(d / "pose.png")}


def apply_reference(d: Path, chars: list[dict]) -> None:
    """A single-character shot whose character has a reference sheet gets that character's front view
    as reference.png, so `identity: auto` falls back to IPAdapter when no LoRA is found. (A sheet is
    drawn front | turned | turned, so the front view is its leftmost third.) Never overwrites a
    reference the shot already has."""
    if len(chars) != 1 or not chars[0].get("ref") or (d / "reference.png").exists():
        return
    try:
        src = resolve_ref(str(chars[0]["ref"]))
    except (ValueError, FileNotFoundError):
        return
    with Image.open(src) as im:
        w, h = im.size
        # the front figure stands at 20% of the width (see makeRefSheet); crop around it, not a blind third
        front = im.crop((int(w * 0.04), 0, int(w * 0.36), h)) if w > h * 1.2 else im.copy()
        front.convert("RGB").save(d / "reference.png")


def projects() -> list[str]:
    if not PROJECTS.exists():
        return []
    return sorted(p.parent.name for p in PROJECTS.glob("*/project.json"))


# --------------------------------------------------------------------- script import
def import_script(script_path: Path) -> dict:
    """Turn a `mangapipe page` script into an editor document (panels, renders, bubbles)."""
    script = load_script(script_path)
    rtl = str(script.get("reading", "rtl")).lower() != "ltr"
    shots_dir = (ROOT / script.get("shots_dir", "shots")).resolve()
    bmap = {b["key"]: b for b in bubbles()}
    lmap = {l["n"]: l for l in layouts()}
    pages = []
    for page in script["pages"]:
        lay = page.get("layout", 1)
        if isinstance(lay, dict):
            rects = grid_rects(lay)
        else:
            num = int(re.sub(r"\D", "", str(lay)) or 1)
            rects = [tuple(r) for r in lmap[num]["rects"]]
        rects = reading_order(rects, rtl)
        slots, free = {}, list(range(len(rects)))
        for p in page.get("panels") or []:
            if p.get("panel") is not None:
                slots[int(p["panel"]) - 1] = p
                free.remove(int(p["panel"]) - 1)
        for p in page.get("panels") or []:
            if p.get("panel") is None and free:
                slots[free.pop(0)] = p
        layers, texts = [], []
        for i, (x, y, w, h) in enumerate(rects):
            p = slots.get(i, {})
            sd = _shot_dir(p, shots_dir) if p else None
            src = None
            try:
                src = find_render(p, sd, ROOT) if p else None
            except Exception:
                pass
            img = None
            if src is not None and ROOT in src.resolve().parents:
                with Image.open(src) as im:
                    iw, ih = im.size
                img = {"ref": mp_ref(src), "iw": iw, "ih": ih, "fit": p.get("fit", "cover"),
                       "focus": list(p.get("focus", (0.5, 0.5))), "zoom": float(p.get("zoom", 1.0)), "flip": bool(p.get("flip"))}
            layers.append({"type": "panel", "x": x, "y": y, "w": w, "h": h, "shot": p.get("shot") or "", "image": img})
            dlg = p["dialogue"] if "dialogue" in p else _shot_dialogue(sd)
            texts += [dialogue_layer(d, (x, y, w, h), bmap) for d in auto(dlg, rtl)]
        texts += [dialogue_layer(d, (0, 0, PAGE_W, PAGE_H), bmap) for d in auto(page.get("dialogue") or [], rtl)]
        pages.append({"layers": layers + [t for t in texts if t]})
    return {"title": script.get("title", script_path.stem), "reading": "rtl" if rtl else "ltr", "pages": pages}


def grid_rects(spec: dict) -> list[tuple]:
    from mp.page import grid_layout
    return grid_layout(spec, 1.0)[1]


def auto(dlg, rtl):
    from mp.page import auto_place
    return auto_place(list(dlg or []), rtl)


def dialogue_layer(d: dict, rect, bmap) -> dict | None:
    RX, RY, W, H = rect
    px = lambda v, tot: float(v) * tot if float(v) <= 1.0 else float(v)
    at = d.get("at", [0.5, 0.15])
    cx, cy = RX + px(at[0], W), RY + px(at[1], H)
    bw = px(d.get("size", 0.38), W)
    kind = str(d.get("bubble", "001"))
    common = {"text": str(d.get("text", "")), "fontSize": int(d.get("font_px") or 0), "bold": bool(d.get("bold")),
              "color": d.get("color", "auto") if isinstance(d.get("color", "auto"), str) else "auto"}
    if kind in ("sfx", "none"):
        return {"type": "text", "x": cx, "y": cy, "w": bw, "h": bw * 0.4, "sfx": kind == "sfx",
                **common, "fontSize": common["fontSize"] or 90, "color": "#ffffff" if kind == "sfx" else "#000000"}
    if kind in ("caption", "box"):
        return {"type": "caption", "x": cx - bw / 2, "y": cy - bw * 0.08, "w": bw, "h": bw * 0.16,
                "fill": "#fff0aa" if kind == "caption" else "#ffffff", **common}
    key = re.sub(r"\D", "", kind).zfill(3)
    b = bmap.get(key) or bmap.get("001")
    bh = bw * b["h"] / b["w"]
    return {"type": "bubble", "bubble": b["key"], "x": cx - bw / 2, "y": cy - bh / 2, "w": bw, "h": bh,
            "flip": bool(d.get("flip")), "rotate": float(d.get("rotate", 0)), **common}


# ---------------------------------------------------------------------------- jobs
JOBS: dict[str, dict] = {}
MANGAPIPE = ROOT / "mangapipe"
SHOT_CMDS = {"run", "render", "grab", "compose"}
POD_ACTIONS = {"status", "start", "stop", "url", "restart"}


def start_job(args: list[str], label: str) -> str:
    jid = uuid.uuid4().hex[:8]
    job = {"id": jid, "label": label, "args": args, "lines": [], "done": False, "code": None, "started": time.time()}
    JOBS[jid] = job

    def run():
        try:
            proc = subprocess.Popen([str(MANGAPIPE), *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, bufsize=1)
            job["proc"] = proc
            for line in proc.stdout:
                job["lines"].append(line.rstrip("\n"))
            job["code"] = proc.wait()
        except Exception as e:  # noqa: BLE001
            job["lines"].append(f"error: {e}")
            job["code"] = -1
        job["done"] = True

    threading.Thread(target=run, daemon=True).start()
    return jid


_pod = {"t": 0.0, "text": "", "busy": False}


def pod_status() -> dict:
    """`mangapipe pod status`, cached for 30 s (runpodctl is slow)."""
    if time.time() - _pod["t"] > 30 and not _pod["busy"]:
        _pod["busy"] = True
        try:
            r = subprocess.run([str(MANGAPIPE), "pod", "status"], cwd=ROOT, capture_output=True, text=True, timeout=60)
            _pod["text"] = (r.stdout + r.stderr).strip().splitlines()[-1] if (r.stdout + r.stderr).strip() else ""
        except Exception as e:  # noqa: BLE001
            _pod["text"] = f"error: {e}"
        _pod["t"] = time.time()
        _pod["busy"] = False
    t = _pod["text"]
    url = re.search(r"https://\S+", t)
    return {"text": t, "running": "RUNNING" in t, "ready": "ready" in t.lower(), "url": url.group(0) if url else None,
            "target": CFG.target}


# ------------------------------------------------------------------------------- http
_GZ: dict[str, bytes] = {}
_JSON_CACHE: dict[str, tuple] = {}


def _gzip(body: bytes, key: str | None) -> bytes:
    """gzip level 6; responses with an ETag are compressed once and kept."""
    import gzip
    if key and key in _GZ:
        return _GZ[key]
    out = gzip.compress(body, 6, mtime=0)
    if key:
        if len(_GZ) > 64:
            _GZ.clear()
        _GZ[key] = out
    return out


BLOB_RE = re.compile(r"/api/project/([^/]{1,80})/blob/([0-9a-f]{64})")


def blob_path(name: str, digest: str) -> Path:
    """Content-addressed project data (painted layers, masks, imported art): pages/<name>/blobs/<sha256>."""
    name = unquote(name)
    if not NAME_RE.match(name):
        raise ValueError("bad project name")
    return PROJECTS / name / "blobs" / digest


class Handler(BaseHTTPRequestHandler):
    server_version = "MangaMaker/1"

    def log_message(self, fmt, *args):
        if not self.path.startswith(("/img", "/api/jobs", "/static")):
            sys.stderr.write("[ui] " + fmt % args + "\n")

    def send(self, code: int, body: bytes, ctype: str, cache: bool = False, etag: str | None = None):
        """cache=True: immutable for a day (images, fonts). etag: revalidate (code, index, catalogs), so a
        reload costs a 304 instead of the whole file. Text over 1.5 KB is gzipped when the browser asks."""
        if etag and self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.end_headers()
            return
        gz = len(body) > 1500 and "gzip" in (self.headers.get("Accept-Encoding") or "") and \
            ctype.split(";")[0] in ("application/json", "text/javascript", "text/css", "text/html", "image/svg+xml")
        if gz:
            body = _gzip(body, etag)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        if etag:
            self.send_header("ETag", etag)
        self.send_header("Cache-Control", "max-age=86400" if cache else "no-cache" if etag else "no-store")
        self.end_headers()
        self.wfile.write(body)

    def file(self, p: Path, ctype: str):
        st = p.stat()
        self.send(200, p.read_bytes(), ctype, etag=f'"{st.st_mtime_ns:x}-{st.st_size:x}"')

    def cached_json(self, name: str, build, deps: list[Path]):
        """A JSON answer rebuilt only when one of `deps` changes (mtimes), served with an ETag."""
        sig = "|".join(f"{d}:{d.stat().st_mtime_ns if d.exists() else 0}" for d in deps)
        hit = _JSON_CACHE.get(name)
        if not hit or hit[0] != sig:
            body = json.dumps(build(), separators=(",", ":")).encode()
            hit = (sig, body, '"' + hashlib.sha1(body).hexdigest()[:16] + '"')
            _JSON_CACHE[name] = hit
        return self.send(200, hit[1], "application/json", etag=hit[2])

    def json(self, data, code: int = 200):
        self.send(code, json.dumps(data).encode(), "application/json")

    def body(self) -> bytes:
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def jbody(self) -> dict:
        b = self.body()
        return json.loads(b) if b else {}

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path in ("/", "/index.html", "/favicon.ico") or u.path.startswith(("/assets/", "/static/")) or u.path == "/favicon.svg":
                if not (STATIC / "index.html").exists():
                    return self.send(503, b"The editor has not been built yet. Run: cd ui/web && npm install && npm run build  (./mangapipe-ui does this for you)",
                                     "text/plain; charset=utf-8")
                rel = {"/": "index.html", "/index.html": "index.html", "/favicon.ico": "favicon.svg"}.get(u.path) or unquote(u.path.lstrip("/"))
                if rel.startswith("static/"):
                    rel = rel[len("static/"):]
                p = (STATIC / rel).resolve()
                if STATIC.resolve() not in p.parents or not p.is_file():
                    return self.json({"error": "not found"}, 404)
                ctype = {".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".html": "text/html", ".map": "application/json",
                         ".woff2": "font/woff2", ".png": "image/png"}.get(p.suffix, "application/octet-stream")
                if u.path.startswith("/assets/"):      # file names carry a content hash: cache for good
                    return self.send(200, p.read_bytes(), ctype + "; charset=utf-8", cache=True)
                return self.file(p, ctype + "; charset=utf-8")
            if u.path == "/font":
                comp = CFG.compose
                f = Path(comp.get("font_bold") if q.get("bold") else comp.get("font"))
                return self.send(200, f.read_bytes(), "font/ttf", cache=True)
            if u.path == "/img":
                p = resolve_ref(q["ref"])
                data, ctype = sized(p, int(q["w"]) if q.get("w") else None)
                return self.send(200, data, ctype, cache=True)
            if u.path == "/api/catalog":
                return self.cached_json("catalog", lambda: {"bubbles": bubbles(), "layouts": layouts(), "assets": assets(),
                                  "styles": list(CFG.styles), "reading": "rtl", "page": [PAGE_W, PAGE_H],
                                  "maxFont": int(CFG.compose.get("page_max_font_px", 56)),
                                  "scripts": sorted(p.name for p in (ROOT / "scripts").glob("*.y*ml"))},
                    deps=[ROOT / "scripts", UPLOADS, CFG.path, TPL])
            if u.path == "/api/shots":
                return self.json(shots())
            if u.path == "/api/projects":
                return self.json(projects())
            if u.path == "/api/project":
                name = q.get("name", "")
                if not NAME_RE.match(name):
                    return self.json({"error": "bad name"}, 400)
                p = PROJECTS / name / "project.json"
                return self.json(json.loads(p.read_text()) if p.exists() else {"error": "not found"}, 200 if p.exists() else 404)
            m = BLOB_RE.fullmatch(u.path)
            if m:
                f = blob_path(*m.groups())
                return self.send(200, f.read_bytes(), "application/octet-stream", cache=True) if f.exists() else self.json({"error": "no such blob"}, 404)
            if u.path == "/api/pod":
                return self.json(pod_status())
            if u.path == "/api/poses":
                return self.cached_json("poses", pose_library, deps=[POSES / "library.json", POSES / "h_library.json", POSES / "h_mods_library.json", POSES / "custom.json", CFG.studio_pose_dir])
            if u.path == "/api/guide":
                return self.file(ROOT / "docs" / "SCRIPT_WIZARD.md", "text/markdown; charset=utf-8")
            if u.path == "/api/cast":
                return self.json({"cast": json.loads(CAST.read_text(encoding="utf-8")) if CAST.exists() else []})
            if u.path == "/api/pose/scene":
                p = shot_dir(q.get("name", "")) / "pose_scene.json"
                return self.json(json.loads(p.read_text()) if p.exists() else {"error": "no scene"}, 200 if p.exists() else 404)
            if u.path.startswith("/api/jobs/"):
                job = JOBS.get(u.path.rsplit("/", 1)[-1])
                if not job:
                    return self.json({"error": "no such job"}, 404)
                since = int(q.get("since", 0))
                return self.json({**{k: job[k] for k in ("id", "label", "done", "code")}, "lines": job["lines"][since:], "next": len(job["lines"])})
            if u.path == "/api/jobs":
                return self.json([{k: j[k] for k in ("id", "label", "done", "code", "started")} for j in JOBS.values()])
            return self.json({"error": "not found"}, 404)
        except (FileNotFoundError, KeyError) as e:
            return self.json({"error": f"not found: {e}"}, 404)
        except Exception as e:  # noqa: BLE001
            return self.json({"error": str(e)}, 400)

    def do_PUT(self):
        u = urlparse(self.path)
        try:
            m = BLOB_RE.fullmatch(u.path)
            if not m:
                return self.json({"error": "not found"}, 404)
            f = blob_path(*m.groups())
            if f.exists():
                return self.json({"ok": True, "exists": True})
            data = self.body()
            if hashlib.sha256(data).hexdigest() != m.group(2):
                return self.json({"error": "content does not match its hash"}, 400)
            f.parent.mkdir(parents=True, exist_ok=True)
            tmp = f.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(f)
            return self.json({"ok": True})
        except Exception as e:  # noqa: BLE001
            return self.json({"error": str(e)}, 400)

    def do_POST(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/api/project":
                doc = self.jbody()
                name = q.get("name", "")
                if not NAME_RE.match(name):
                    return self.json({"error": "project name: letters, digits, space, _ - . only"}, 400)
                d = PROJECTS / name
                d.mkdir(parents=True, exist_ok=True)
                (d / "project.json").write_text(json.dumps(doc, indent=1))
                return self.json({"ok": True, "path": str(d / "project.json")})
            if u.path == "/api/export/page":
                name, n = q["name"], int(q["n"])
                if not NAME_RE.match(name):
                    return self.json({"error": "bad name"}, 400)
                d = PROJECTS / name
                d.mkdir(parents=True, exist_ok=True)
                im = Image.open(io.BytesIO(self.body())).convert("RGB")
                dest = d / f"page_{n:02d}.png"
                im.save(dest)
                return self.json({"ok": True, "path": str(dest)})
            if u.path == "/api/export/pdf":
                name, count = q["name"], int(q["count"])
                d = PROJECTS / name
                files = [d / f"page_{n:02d}.png" for n in range(1, count + 1)]
                missing = [f.name for f in files if not f.exists()]
                if missing:
                    return self.json({"error": f"missing {', '.join(missing)}"}, 400)
                ims = [Image.open(f).convert("RGB") for f in files]
                dest = d / f"{name}.pdf"
                ims[0].save(dest, save_all=True, append_images=ims[1:], resolution=300)
                return self.json({"ok": True, "path": str(dest)})
            if u.path == "/api/import":
                name = q.get("script", "")
                p = (ROOT / "scripts" / name).resolve()
                if (ROOT / "scripts").resolve() not in p.parents or not p.exists():
                    return self.json({"error": "script not found"}, 404)
                return self.json(import_script(p))
            if u.path == "/api/upload":
                fname = Path(q.get("name", "upload.png")).name
                stem, ext = Path(fname).stem, Path(fname).suffix.lower()
                if ext not in (".png", ".jpg", ".jpeg", ".webp"):
                    return self.json({"error": "png, jpg or webp only"}, 400)
                UPLOADS.mkdir(parents=True, exist_ok=True)
                stem = re.sub(r"[^A-Za-z0-9_\-]", "_", stem)[:60] or "upload"
                dest = UPLOADS / f"{stem}{ext}"
                k = 1
                while dest.exists():
                    dest = UPLOADS / f"{stem}_{k}{ext}"
                    k += 1
                dest.write_bytes(self.body())
                with Image.open(dest) as im:
                    w, h = im.size
                return self.json({"ref": mp_ref(dest), "name": dest.stem, "w": w, "h": h})
            if u.path == "/api/shot/yaml":
                body = self.jbody()
                d = shot_dir(body["name"])
                yaml.safe_load(body["yaml"])  # refuse broken YAML before writing
                side = next((d / n for n in SIDECAR_NAMES if (d / n).exists()), d / "shot.yaml")
                side.write_text(body["yaml"], encoding="utf-8")
                return self.json({"ok": True})
            if u.path == "/api/shot/new":
                return self.json(create_shot(self.jbody()))
            if u.path == "/api/cast":
                return self.json({"cast": json.loads(CAST.read_text(encoding="utf-8")) if CAST.exists() else []})
            if u.path == "/api/pose/scene":
                p = shot_dir(q.get("name", "")) / "pose_scene.json"
                return self.json(json.loads(p.read_text()) if p.exists() else {"error": "no scene"}, 200 if p.exists() else 404)
            if u.path.startswith("/api/jobs/"):
                job = JOBS.get(u.path.rsplit("/", 1)[-1])
                if not job:
                    return self.json({"error": "no such job"}, 404)
                since = int(q.get("since", 0))
                return self.json({**{k: job[k] for k in ("id", "label", "done", "code")}, "lines": job["lines"][since:], "next": len(job["lines"])})
            if u.path == "/api/jobs":
                return self.json([{k: j[k] for k in ("id", "label", "done", "code", "started")} for j in JOBS.values()])
            return self.json({"error": "not found"}, 404)
        except (FileNotFoundError, KeyError) as e:
            return self.json({"error": f"not found: {e}"}, 404)
        except Exception as e:  # noqa: BLE001
            return self.json({"error": str(e)}, 400)

    def do_POST(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/api/project":
                doc = self.jbody()
                name = q.get("name", "")
                if not NAME_RE.match(name):
                    return self.json({"error": "project name: letters, digits, space, _ - . only"}, 400)
                d = PROJECTS / name
                d.mkdir(parents=True, exist_ok=True)
                (d / "project.json").write_text(json.dumps(doc, indent=1))
                return self.json({"ok": True, "path": str(d / "project.json")})
            if u.path == "/api/export/page":
                name, n = q["name"], int(q["n"])
                if not NAME_RE.match(name):
                    return self.json({"error": "bad name"}, 400)
                d = PROJECTS / name
                d.mkdir(parents=True, exist_ok=True)
                im = Image.open(io.BytesIO(self.body())).convert("RGB")
                dest = d / f"page_{n:02d}.png"
                im.save(dest)
                return self.json({"ok": True, "path": str(dest)})
            if u.path == "/api/export/pdf":
                name, count = q["name"], int(q["count"])
                d = PROJECTS / name
                files = [d / f"page_{n:02d}.png" for n in range(1, count + 1)]
                missing = [f.name for f in files if not f.exists()]
                if missing:
                    return self.json({"error": f"missing {', '.join(missing)}"}, 400)
                ims = [Image.open(f).convert("RGB") for f in files]
                dest = d / f"{name}.pdf"
                ims[0].save(dest, save_all=True, append_images=ims[1:], resolution=300)
                return self.json({"ok": True, "path": str(dest)})
            if u.path == "/api/import":
                name = q.get("script", "")
                p = (ROOT / "scripts" / name).resolve()
                if (ROOT / "scripts").resolve() not in p.parents or not p.exists():
                    return self.json({"error": "script not found"}, 404)
                return self.json(import_script(p))
            if u.path == "/api/upload":
                fname = Path(q.get("name", "upload.png")).name
                stem, ext = Path(fname).stem, Path(fname).suffix.lower()
                if ext not in (".png", ".jpg", ".jpeg", ".webp"):
                    return self.json({"error": "png, jpg or webp only"}, 400)
                UPLOADS.mkdir(parents=True, exist_ok=True)
                stem = re.sub(r"[^A-Za-z0-9_\-]", "_", stem)[:60] or "upload"
                dest = UPLOADS / f"{stem}{ext}"
                k = 1
                while dest.exists():
                    dest = UPLOADS / f"{stem}_{k}{ext}"
                    k += 1
                dest.write_bytes(self.body())
                with Image.open(dest) as im:
                    w, h = im.size
                return self.json({"ref": mp_ref(dest), "name": dest.stem, "w": w, "h": h})
            if u.path == "/api/shot/yaml":
                body = self.jbody()
                d = shot_dir(body["name"])
                yaml.safe_load(body["yaml"])  # refuse broken YAML before writing
                side = next((d / n for n in SIDECAR_NAMES if (d / n).exists()), d / "shot.yaml")
                side.write_text(body["yaml"], encoding="utf-8")
                return self.json({"ok": True})
            if u.path == "/api/shot/new":
                body = self.jbody()
                d = shot_dir(body["name"], must_exist=False)
                if d.exists():
                    return self.json({"error": "a shot with that name exists"}, 400)
                chars = [c for c in (body.get("characters") or []) if str(c.get("name", "")).strip()]
                if not chars and body.get("character"):
                    chars = [{"name": body["character"], "series": body.get("series") or ""}]
                chars = chars or [{"name": "", "series": ""}]   # unnamed: generic, described by tags
                side = write_example(d, str(chars[0]["name"]).strip(), str(chars[0].get("series", "")).strip())
                text = with_characters(side.read_text(encoding="utf-8"), chars)
                if body.get("prompt"):
                    text = re.sub(r"(?m)^prompt:.*$", lambda m: "prompt: " + json.dumps(str(body["prompt"]), ensure_ascii=False), text)
                if body.get("keep"):   # made by the script wizard: the editor letters the page, no sample line
                    text = re.sub(r"(?ms)^dialogue:\n.*\Z", "dialogue: []\n", text)
                side.write_text(text, encoding="utf-8")
                apply_reference(d, chars)
                return self.json({"ok": True})
            if u.path == "/api/cast":
                CAST.write_text(json.dumps(self.jbody().get("cast", []), indent=1, ensure_ascii=False), encoding="utf-8")
                return self.json({"ok": True})
            if u.path == "/api/shot/style":
                body = self.jbody()
                if body.get("style") not in CFG.styles:
                    return self.json({"error": "unknown style"}, 400)
                for name in body.get("names") or []:
                    d = shot_dir(name)
                    side = next((d / n for n in SIDECAR_NAMES if (d / n).exists()), None)
                    if side is None or side.suffix == ".json":
                        continue
                    t = side.read_text(encoding="utf-8")
                    line = f"style: {body['style']}"
                    t = re.sub(r"(?m)^style:.*$", line, t) if re.search(r"(?m)^style:", t) else t + line + "\n"
                    side.write_text(t, encoding="utf-8")
                return self.json({"ok": True})
            if u.path == "/api/pose/detect":
                return self.json(detect_poses(q.get("name", "image.png"), self.body()))
            if u.path == "/api/pose/shot":
                return self.json(save_pose_shot(self.jbody()))
            if u.path == "/api/poses/custom":
                return self.json(save_custom_pose(self.jbody()))
            m = re.fullmatch(r"/api/jobs/([0-9a-f]{8})/(cancel|dismiss)", u.path)
            if m:   # the x on a job: stop it if it is still running, and forget it
                job = JOBS.pop(m.group(1), None)
                proc = job and job.get("proc")
                if proc is not None and proc.poll() is None:
                    proc.terminate()
                return self.json({"ok": True})
            if u.path == "/api/jobs":
                body = self.jbody()
                cmd = body.get("cmd")
                if cmd in SHOT_CMDS:
                    d = shot_dir(body["shot"])
                    args = [cmd, str(d.relative_to(ROOT))]
                    if cmd in ("run", "render") and body.get("seed") not in (None, ""):
                        args += ["--seed", str(int(body["seed"]))]
                    if cmd == "run":
                        args.append("--no-compose")  # the editor letters the page itself
                    label = f"{cmd} {d.name}"
                elif cmd == "pod" and body.get("action") in POD_ACTIONS:
                    args, label = ["pod", body["action"]], f"pod {body['action']}"
                    _pod["t"] = 0.0
                else:
                    return self.json({"error": "command not allowed"}, 400)
                return self.json({"id": start_job(args, label)})
            return self.json({"error": "not found"}, 404)
        except Exception as e:  # noqa: BLE001
            return self.json({"error": str(e)}, 400)


def with_characters(text: str, chars: list[dict]) -> str:
    """Swap the template's one-character block for several, in frame order (leftmost first)."""
    q = lambda v: json.dumps(str(v).strip(), ensure_ascii=False)
    def one(c):
        generic = bool(c.get("generic")) or not str(c.get("name", "")).strip()
        lines = [f"  - name: {q(c.get('name', ''))}", f"    series: {q(c.get('series', ''))}"]
        if generic:
            lines.append("    generic: true             # unnamed: no name tag, no LoRA; describe with tags")
        lora = str(c.get("lora") or "").strip()
        if generic and lora in ("", "auto"):
            lora = "none"
        lines.append("    lora: " + (q(lora) if lora and lora != "auto" else "auto                # auto | none | file.safetensors | https://civitai.com/models/..."))
        lines.append("    lora_weight: 0.8")
        if c.get("gender") in ("girl", "boy"):
            lines.append(f"    gender: {c['gender']}")
        lines.append(f"    tags: {q(c.get('tags', ''))}" + ("" if c.get("tags") else "                  # appearance tags used when no LoRA is found"))
        return "\n".join(lines) + "\n"
    block = "characters:                  # left to right in the frame\n" + "".join(one(c) for c in chars)
    m = re.search(r"(?m)^characters:.*\n", text)   # the line may carry a comment after a first rewrite
    if not m:
        raise ValueError("no characters block")
    start = m.start()
    end = text.index("\nidentity:", start) + 1
    return text[:start] + block + "\n" + text[end:]


def enrich_from_cast(chars: list[dict]) -> list[dict]:
    """Fill name-only characters from the character sheet (series, LoRA, looks, girl/boy, reference)."""
    cast = {c.get("name", "").lower(): c for c in (json.loads(CAST.read_text(encoding="utf-8")) if CAST.exists() else [])}
    out = []
    for c in chars:
        k = cast.get(str(c.get("name", "")).lower())
        if k:
            c = {**c, "series": c.get("series") or k.get("series", ""), "lora": c.get("lora") or k.get("lora", "auto"),
                 "tags": c.get("tags") or k.get("tags", ""), "gender": c.get("gender") or k.get("gender", "girl"), "ref": c.get("ref") or k.get("ref")}
        out.append(c)
    return out


def create_shot(body: dict) -> dict:
    """A new shot folder with its sidecar: characters (left to right), prompt, reference from the cast."""
    d = shot_dir(body["name"], must_exist=False)
    if d.exists():
        raise ValueError("a shot with that name exists")
    chars = [c for c in (body.get("characters") or []) if str(c.get("name", "")).strip()]
    if not chars and body.get("character"):
        chars = [{"name": body["character"], "series": body.get("series") or ""}]
    chars = chars or [{"name": "", "series": ""}]   # unnamed: generic, described by tags
    if body.get("cast"):
        chars = enrich_from_cast(chars)
    side = write_example(d, str(chars[0]["name"]).strip(), str(chars[0].get("series", "")).strip())
    text = with_characters(side.read_text(encoding="utf-8"), chars)
    if body.get("prompt"):
        text = re.sub(r"(?m)^prompt:.*$", lambda m: "prompt: " + json.dumps(str(body["prompt"]), ensure_ascii=False), text)
    if body.get("keep"):   # made by the script wizard: the editor letters the page, no sample line
        text = re.sub(r"(?ms)^dialogue:\n.*\Z", "dialogue: []\n", text)
    side.write_text(text, encoding="utf-8")
    apply_reference(d, chars)
    return {"ok": True}


def shot_dir(name: str, must_exist: bool = True) -> Path:
    if not NAME_RE.match(name or "") or name.startswith("."):
        raise ValueError("shot name: letters, digits, space, _ - . only")
    d = SHOTS / name
    if must_exist and not d.is_dir():
        raise FileNotFoundError(f"no shot {name}")
    return d


def warm():
    """Index the templates and pre-size the pictures the editor asks for first, so the library and
    a zoomed-out page open from cache instead of decoding 4000 px PNGs on demand."""
    for b in bubbles():
        for w in (160, 512):
            try:
                sized(resolve_ref(b["ref"]), w)
            except Exception:  # noqa: BLE001
                pass
    for l in layouts():
        try:
            sized(resolve_ref(l["ref"]), 160)
        except Exception:  # noqa: BLE001
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1", help="address to listen on (0.0.0.0 inside a container; the editor has no login)")
    a = ap.parse_args()
    threading.Thread(target=warm, daemon=True).start()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"MangaMaker on http://{a.host}:{a.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
