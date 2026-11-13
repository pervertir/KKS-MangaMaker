"""KKS-MangaMaker as an MCP server: write a script, get pages, pose the shots, render them.

Speaks the Model Context Protocol with no SDK dependency, so it runs on the same interpreter as
`mangapipe` (Python 3.9+) and works with any MCP client:

    ./mangamaker-mcp                          stdio (newline-delimited JSON-RPC), what most clients launch
    ./mangamaker-mcp --http [--port 8766]     Streamable HTTP at http://127.0.0.1:8766/mcp
                                              (+ the deprecated HTTP+SSE pair at /sse and /messages)

Both protocol eras are served side by side: the stateless revision (2026-07-28: every request names
its version in `_meta`, `server/discover`) and the handshake revisions (2025-11-25 back to
2024-11-05: `initialize` first). docs/MCP.md has the setup for each client.

The editor (./mangapipe-ui, http://127.0.0.1:8765) opens whatever these tools write: projects in
pages/<name>/project.json, shots in shots/<name>/.
"""
from __future__ import annotations

import argparse
import base64
import hmac
import importlib.util
import io
import json
import os
import queue
import re
import secrets
import select
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "ui"))

MODERN = ("2026-07-28",)                                            # stateless: version rides in every request's _meta
LEGACY = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")   # negotiated once by `initialize`
SUPPORTED = MODERN + LEGACY
SERVER = {"name": "kks-mangamaker", "title": "KKS-MangaMaker", "version": "2.0.0"}
GUIDE = ROOT / "docs" / "SCRIPT_WIZARD.md"
GUIDE_URI = "mangamaker://docs/script-wizard"
META = "io.modelcontextprotocol/"
DEPS = (("yaml", "pyyaml"), ("PIL", "pillow"), ("numpy", "numpy"))
INSTRUCTIONS = ("KKS-MangaMaker turns a plain-text script into manga pages and renders one shot per panel. Read script_format (or the "
                "Script Wizard guide resource) before writing a script, then: check_script, cast (record the characters once), "
                "build_pages_from_script, pose_shot each shot, and only if the user wants renders: pod status/start, render_shot, "
                "place_renders. render_shot, pose_from_image and `pod start` use the GPU pod, which bills while it runs: ask first, and "
                "`pod stop` when done. The user opens the project in the editor (./mangapipe-ui) to letter and export.")


class RpcError(Exception):
    """A JSON-RPC error reply; `status` is the HTTP status the Streamable HTTP transport answers with."""

    def __init__(self, code: int, message: str, data=None, status: int = 200):
        super().__init__(message)
        self.code, self.message, self.data, self.status = code, message, data, status


class ToolError(Exception):
    """A problem the model can fix by calling again differently: reported as an isError result, not a protocol error."""


def log(msg: str):
    sys.stderr.write(f"[mcp] {msg}\n")
    sys.stderr.flush()


# ------------------------------------------------------------------------------- one tool call
class Job:
    """A running request: its progress token, its cancel switch, and the child process to kill with it."""

    def __init__(self, token=None, notify=None, with_message: bool = True):
        self.token, self.notify, self.with_message = token, notify, with_message
        self.cancelled = threading.Event()
        self.proc = None
        self.n = 0

    def progress(self, message: str):
        if self.token is None or self.notify is None or self.cancelled.is_set():
            return
        self.n += 1                                   # the spec only asks that it increases; the total is unknown
        p = {"progressToken": self.token, "progress": self.n}
        if self.with_message:
            p["message"] = message[:300]
        try:
            self.notify({"jsonrpc": "2.0", "method": "notifications/progress", "params": p})
        except Exception:  # noqa: BLE001  a client that went away must not fail the tool
            pass

    def cancel(self):
        self.cancelled.set()
        p = self.proc
        if p is not None and p.poll() is None:
            try:
                p.terminate()
            except OSError:
                pass


_local = threading.local()


def _job() -> Job:
    return getattr(_local, "job", None) or Job()


def _srv():
    try:
        import server as srv  # ui/server.py: shot, cast and pose helpers shared with the editor
    except ImportError as e:
        raise ToolError(f"a Python package is missing ({e}). Install the pipeline's packages into the interpreter that runs this server: "
                        f"{sys.executable} -m pip install pyyaml pillow numpy requests")
    return srv


# ------------------------------------------------------------------------------------- tools
def t_script_format(_: dict) -> str:
    if not GUIDE.exists():
        raise ToolError("docs/SCRIPT_WIZARD.md is missing from this checkout")
    return GUIDE.read_text(encoding="utf-8")


def t_check_script(a: dict) -> dict:
    from mp.wizard import parse_script, summarize
    return summarize(parse_script(a["script"], int(a.get("max_panels_per_page") or 6)))


def t_build_pages(a: dict) -> dict:
    from mp.wizard import build_document, parse_script, summarize
    srv = _srv()
    project = a["project"].strip()
    if not srv.NAME_RE.match(project) or project.startswith("."):
        raise ToolError("project: letters, digits, space, _ - . only (it becomes the folder pages/<project>/)")
    pages = parse_script(a["script"], int(a.get("max_panels_per_page") or 6))
    if not pages or not any(p["panels"] for p in pages):
        raise ToolError("the script has no panels: a panel line looks like `[Name, Name] what the picture shows` (see script_format)")
    dest = srv.PROJECTS / project / "project.json"
    existing = json.loads(dest.read_text(encoding="utf-8")) if a.get("mode") == "append" and dest.exists() else None
    reading = a.get("reading") or (existing or {}).get("reading") or "rtl"
    prefix = re.sub(r"[^\w\-.]", "_", a.get("shot_prefix") or project)[:40]
    doc, shots = build_document(pages, a.get("title") or project, reading, prefix, a.get("series", ""), a.get("make_shots", True),
                                first_page=len(existing["pages"]) + 1 if existing else 1)
    if existing:
        existing["pages"] += doc["pages"]
        doc = existing
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    made, skipped = [], []
    for s in shots:
        try:
            srv.create_shot({**s, "keep": True, "cast": True})
            made.append(s["name"])
        except ValueError as e:
            skipped.append(f"{s['name']}: {e}")
    return {"project": str(dest.relative_to(ROOT)), "open": f"http://127.0.0.1:8765 (File › Open… › {project})", "shots_created": made,
            "shots_skipped": skipped, **summarize(pages)}


def t_list_shots(_: dict) -> dict:
    import yaml
    out = []
    for s in _srv().shots():
        y = yaml.safe_load(s["yaml"] or "{}") or {}
        out.append({"shot": s["name"], "characters": [c.get("name") for c in (y.get("characters") or []) if isinstance(c, dict)],
                    "prompt": y.get("prompt", ""), "posed": bool(s["pose"]), "renders": len(s["renders"]), "style": y.get("style")})
    return {"shots": out}


def _library(adult: bool | None = None):
    lib = _srv().pose_library(adult)
    poses = {p["id"]: p for p in lib["poses"]}
    for p in lib["poses"]:
        for i, m in enumerate(p.get("members") or []):
            poses[f"{p['id']}#{i}"] = m
    return lib, poses


def t_list_poses(a: dict) -> dict:
    lib, _ = _library()
    kind, q, lim = a.get("type"), (a.get("search") or "").lower(), int(a.get("limit") or 40)
    hits = [p for p in lib["poses"] if (not kind or p.get("kind") == kind) and (not q or q in (p["name"] + " " + p.get("kind", "")).lower())]
    return {"types": lib.get("kinds", []), "total": len(hits),
            "poses": [{"id": p["id"], "name": p["name"], "type": p.get("kind"), "figures": len(p.get("members") or [1])} for p in hits[:lim]]}


def t_pose_shot(a: dict) -> dict:
    import yaml
    from mp.poserender import frame, new_char, render
    srv = _srv()
    d = srv.shot_dir(a["shot"], must_exist=False)      # a new shot is created by save_pose_shot
    side = next((d / n for n in srv.SIDECAR_NAMES if (d / n).exists()), None) if d.exists() else None
    known = (yaml.safe_load(side.read_text(encoding="utf-8")) or {}).get("characters", []) if side else []
    lib, poses = _library(adult=True)
    w, h = (int(v) for v in str(a.get("canvas") or "832x1216").lower().split("x"))
    if not (256 <= w <= 2048 and 256 <= h <= 2048):
        raise ToolError("canvas: each side 256 to 2048, e.g. 832x1216 (portrait), 1024x1024, 1216x832 (landscape)")
    scene = {"w": w, "h": h, "prompt": a.get("prompt") or "", "chars": []}
    figs = a.get("figures") or []
    for i, f in enumerate(figs):
        pid = f["pose"]
        group = next((p for p in lib["poses"] if p["id"] == pid and p.get("members")), None)
        if group:                                   # a group pose brings every member, in place
            ga, sa = group.get("aspect", 0.7), w / h
            fit = min(1.0, sa / ga)
            for j, m in enumerate(group["members"]):
                scene["chars"].append(new_char(f"{pid}#{j}", 0.5 + (m["x"] - 0.5) * ga / sa * fit, y=m["y"], scale=m["scale"] * fit,
                                               z=m.get("z", 0), gender=m.get("gender", "girl"), label=m.get("label")))
            continue
        if pid not in poses:
            raise ToolError(f"unknown pose {pid!r}: take an id from list_poses (search by `type` or `search`)")
        x = f.get("x", (i + 1) / (len(figs) + 1))
        scene["chars"].append(new_char(pid, x, scale=f.get("scale"), yaw=f.get("yaw"), flip=f.get("flip"), y=f.get("y")))
    # names left to right: from the figures, else from the shot's characters
    order = sorted(scene["chars"], key=lambda c: c["x"])
    for i, c in enumerate(order):
        src = (figs[i] if i < len(figs) and not any(p.get("members") for p in lib["poses"] if p["id"] == figs[i]["pose"]) else {}) or {}
        k = known[i] if i < len(known) and isinstance(known[i], dict) else {}
        c["name"] = src.get("name") or k.get("name", "")
        c["series"] = k.get("series", "")
        c["gender"] = src.get("gender") or k.get("gender") or c.get("gender", "girl")
        c["tags"] = k.get("tags", "")
    if a.get("framing"):
        frame(scene, poses, a["framing"])
    png = render(scene, poses)
    buf = io.BytesIO()
    png.save(buf, "PNG")
    chars = [{"name": c["name"], "series": c["series"], "gender": c["gender"], "tags": c["tags"]} for c in order]
    srv.save_pose_shot({"name": a["shot"], "png": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
                        "scene": {**scene, "shot": a["shot"]}, "characters": srv.enrich_from_cast(chars),
                        **({"prompt": a["prompt"]} if a.get("prompt") else {})})
    return {"shot": a["shot"], "pose": f"shots/{a['shot']}/pose.png", "figures": len(scene["chars"]), "characters": [c["name"] for c in order]}


def t_pose_from_image(a: dict) -> dict:
    """Detect the people in a local image on the pod; save each as a pose (My poses); optionally pose a shot with them."""
    srv = _srv()
    p = Path(a["image"]).expanduser()
    if not p.is_file():
        raise ToolError(f"no image at {p}: pass the absolute path of a PNG, JPEG or WebP on the machine this server runs on")
    if p.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp", ".bmp"):
        raise ToolError("image: a PNG, JPEG, WebP or BMP file")
    if a.get("shot"):
        srv.shot_dir(a["shot"], must_exist=False)      # a bad name fails before the pod is asked to work
    _job().progress("detecting people on the pod")
    res = srv.detect_poses(p.name, p.read_bytes())
    out = {"guide": res["guide"], "people": [{"pose": x["pose"]["id"], "type": x["pose"].get("kind"), "place": x["place"]} for x in res["people"]]}
    if a.get("shot") and res["people"]:
        ia = res["w"] / res["h"]
        canvas = min((("832x1216", 832 / 1216), ("896x1152", 896 / 1152), ("1024x1024", 1.0), ("1152x896", 1152 / 896), ("1216x832", 1216 / 832)),
                     key=lambda c: abs(c[1] - ia))[0]
        w, h = (int(v) for v in canvas.split("x"))
        figs = [{"pose": x["pose"]["id"], "x": 0.5 + (x["place"]["x"] - 0.5) * ia / (w / h), "y": x["place"]["y"], "scale": x["place"]["scale"]} for x in res["people"]]
        out["shot"] = t_pose_shot({"shot": a["shot"], "figures": figs, "canvas": canvas})
    return out


def _mangapipe(args: list, timeout: int) -> tuple:
    """Run the pipeline CLI on this interpreter. Its output never reaches the protocol stream: it is read here,
    each `[step] ...` line becomes a progress notification, and a cancelled request kills it."""
    job = _job()
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.Popen([sys.executable, str(ROOT / "mangapipe.py"), *args], cwd=str(ROOT), env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    job.proc = proc
    timed_out = threading.Event()

    def expire():
        timed_out.set()
        try:
            proc.kill()
        except OSError:
            pass
    timer = threading.Timer(timeout, expire)
    timer.daemon = True
    timer.start()
    lines = []
    try:
        for line in proc.stdout:
            line = line.rstrip()
            lines.append(line)
            if line.startswith("["):
                job.progress(line)
        code = proc.wait()
    finally:
        timer.cancel()
        job.proc = None
    if timed_out.is_set():
        lines.append(f"error: stopped after {timeout}s without finishing")
    return code, "\n".join(lines)


def t_render_shot(a: dict) -> dict:
    d = _srv().shot_dir(a["shot"])
    args = ["run", f"shots/{d.name}", "--no-compose"]
    if a.get("seed") is not None:
        args += ["--seed", str(int(a["seed"]))]
    with _RENDER:                                     # one render at a time: the pod has one GPU
        if _job().cancelled.is_set():
            raise ToolError("cancelled before it started")
        code, out = _mangapipe(args, 1800)
    lines = [l for l in out.splitlines() if l.startswith("[") or "error" in l.lower()]
    renders = sorted((d / "out").glob("render_*.png"), key=lambda p: p.stat().st_mtime) if (d / "out").exists() else []
    res = {"ok": code == 0, "log": lines[-25:], "latest_render": str(renders[-1].relative_to(ROOT)) if renders else None}
    if code != 0:
        res["hint"] = "if ComfyUI is not answering, check `pod` status and start it; if the pose is missing, call pose_shot first"
    return res


def t_place_renders(a: dict) -> dict:
    from PIL import Image
    srv = _srv()
    if not srv.NAME_RE.match(a["project"]) or a["project"].startswith("."):
        raise ToolError("project: letters, digits, space, _ - . only")
    dest = srv.PROJECTS / a["project"] / "project.json"
    if not dest.exists():
        have = sorted(p.parent.name for p in srv.PROJECTS.glob("*/project.json")) if srv.PROJECTS.exists() else []
        raise ToolError(f"no project {a['project']!r}; projects here: {', '.join(have) or 'none yet (build_pages_from_script makes one)'}")
    doc = json.loads(dest.read_text(encoding="utf-8"))
    placed = []
    for pg in doc["pages"]:
        for l in pg["layers"]:
            if l.get("type") != "panel" or not l.get("shot"):
                continue
            out = ROOT / "shots" / l["shot"] / "out"
            rs = sorted([p for p in out.glob("render_*.png") if not p.stem.endswith("_base")], key=lambda p: p.stat().st_mtime) if out.exists() else []
            if not rs or (l.get("image") and l.get("lockImage")):
                continue
            with Image.open(rs[-1]) as im:
                iw, ih = im.size
            l["image"] = {"ref": srv.mp_ref(rs[-1]), "iw": iw, "ih": ih, "fit": "cover", "focus": [0.5, 0.3], "zoom": 1, "flip": False}
            placed.append(l["shot"])
    dest.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    return {"placed": placed, "project": str(dest.relative_to(ROOT))}


def t_pod(a: dict) -> dict:
    code, out = _mangapipe(["pod", a.get("action") or "status"], 300)
    return {"ok": code == 0, "output": out.strip().splitlines()[-5:]}


def t_cast(a: dict) -> dict:
    srv = _srv()
    cast = json.loads(srv.CAST.read_text(encoding="utf-8")) if srv.CAST.exists() else []
    if a.get("set"):
        by = {c["name"].lower(): c for c in cast if c.get("name")}
        for c in a["set"]:
            if c.get("name", "").strip():
                by[c["name"].lower()] = {**by.get(c["name"].lower(), {}), **c}
        cast = list(by.values())
        srv.CAST.write_text(json.dumps(cast, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"cast": cast}


_RENDER = threading.Lock()
_WRITE = threading.Lock()      # tools that rewrite project.json, cast.json or a shot run one at a time


# --------------------------------------------------------------------------------- tool table
def _s(desc: str, **kw) -> dict:
    return {"type": "string", "description": desc, **kw}


def _i(desc: str, **kw) -> dict:
    return {"type": "integer", "description": desc, **kw}


def _n(desc: str, **kw) -> dict:
    return {"type": "number", "description": desc, **kw}


def _b(desc: str) -> dict:
    return {"type": "boolean", "description": desc}


def _obj(props: dict, required=(), extra: bool = False, desc: str = "") -> dict:
    o = {"type": "object", "properties": props, "additionalProperties": extra}
    if required:
        o["required"] = list(required)
    if desc:
        o["description"] = desc
    return o


NAME = r"^[A-Za-z0-9_\-. ]{1,80}$"
P_SCRIPT = _s("The whole script in Script Wizard format (see script_format).", minLength=1)
P_MAXP = _i("Split a page after this many panels (default 6).", minimum=1, maximum=12)
P_SHOT = _s("Shot name: the folder under shots/ (letters, digits, space, _ - .).", pattern=NAME)
P_PROJECT = _s("Project name: the folder under pages/ (letters, digits, space, _ - .).", pattern=NAME)
O_SUMMARY = {"pages": {"type": "integer"}, "panels": {"type": "integer"}, "characters": {"type": "object", "description": "name -> panels they appear in"},
             "warnings": {"type": "array", "items": {"type": "string"}}, "layout": {"type": "array", "items": {"type": "object"}}}

# name: (function, title, description, inputSchema, hints, outputSchema, lock)
# hints: r = read-only, d = may overwrite or remove something, i = calling again with the same input changes nothing more,
#        o = reaches beyond this machine (the GPU pod, which bills while it runs)
TOOLS = {
    "script_format": (t_script_format, "Script Wizard guide",
                      "The Script Wizard format and writing guide. Read this before writing or converting a script.",
                      _obj({}), "ri", None, None),
    "check_script": (t_check_script, "Check a script",
                     "Parse a Script Wizard script without writing anything: pages, panels, characters, layout, and warnings to fix.",
                     _obj({"script": P_SCRIPT, "max_panels_per_page": P_MAXP}, ["script"]), "ri",
                     _obj(O_SUMMARY, ["pages", "panels", "warnings"], extra=True), None),
    "build_pages_from_script": (t_build_pages, "Build pages from a script",
                                "Turn a script into an editor project (pages, panels, bubbles in reading order) and one shot per panel with its "
                                "characters (filled from the character sheet) and render prompt. Writes pages/<project>/project.json: mode `new` "
                                "replaces an existing project of that name, `append` adds the pages after its last one.",
                                _obj({"script": P_SCRIPT, "project": P_PROJECT,
                                      "title": _s("Title stored in the project (default: the project name)."),
                                      "reading": _s("Reading direction: rtl for manga (default), ltr for western comics.", enum=["rtl", "ltr"]),
                                      "shot_prefix": _s("Shots are named <prefix>_p<page>_<panel>, e.g. ch1 (default: the project name)."),
                                      "series": _s("Series the characters are from, used when a character has none on the character sheet."),
                                      "make_shots": _b("Also create one shot folder per panel (default true)."),
                                      "mode": _s("new (default) or append.", enum=["new", "append"]),
                                      "max_panels_per_page": P_MAXP}, ["script", "project"]), "d", None, _WRITE),
    "list_shots": (t_list_shots, "List shots", "Every shot: characters, prompt, whether it is posed, how many renders.",
                   _obj({}), "ri", _obj({"shots": {"type": "array", "items": {"type": "object"}}}, ["shots"]), None),
    "list_poses": (t_list_poses, "Search the pose library",
                   "Search the pose library (basic, the converted studio poses, saved poses, and H-scene group poses when the editor's "
                   "\"Show adult poses\" preference is on) by type or name. "
                   "The answer lists every type; a pose with figures > 1 is a group pose.",
                   _obj({"type": _s("Exact pose type, as listed in `types` of any answer (e.g. Standing, Sitting, Group poses)."),
                         "search": _s("Words to find in the pose name or type (case-insensitive)."),
                         "limit": _i("How many poses to return (default 40).", minimum=1, maximum=500)}), "ri",
                   _obj({"types": {"type": "array", "items": {"type": "string"}}, "total": {"type": "integer"},
                         "poses": {"type": "array", "items": {"type": "object"}}}, ["types", "total", "poses"]), None),
    "pose_shot": (t_pose_shot, "Pose a shot",
                  "Pose a shot without the editor: place figures from the pose library (a group pose id brings all its figures) and write the "
                  "OpenPose image the render uses (shots/<shot>/pose.png, replacing the previous pose). Figures are listed left to right.",
                  _obj({"shot": P_SHOT,
                        "figures": {"type": "array", "minItems": 1, "maxItems": 8, "description": "The figures, left to right.",
                                    "items": _obj({"pose": _s("Pose id from list_poses.", minLength=1),
                                                   "name": _s("Character name (default: the shot's characters, left to right)."),
                                                   "gender": _s("Body type of the stick figure.", enum=["girl", "boy"]),
                                                   "x": _n("Horizontal centre, 0 (left) to 1 (right); default: spread evenly.", minimum=-0.5, maximum=1.5),
                                                   "y": _n("Vertical position, 0 (top) to 1 (bottom).", minimum=-0.5, maximum=1.5),
                                                   "scale": _n("Size relative to the canvas height (about 0.3 to 1.5).", minimum=0.05, maximum=4),
                                                   "yaw": _n("Turn around the vertical axis in degrees (0 faces the camera).", minimum=-360, maximum=360),
                                                   "flip": _b("Mirror the pose left-right.")}, ["pose"])},
                        "framing": _s("Crop to this camera distance; match the panel's camera words.", enum=["full", "knees", "waist", "chest", "close"]),
                        "canvas": _s("Render size WIDTHxHEIGHT (default 832x1216).", pattern=r"^[0-9]{3,4}[xX][0-9]{3,4}$"),
                        "prompt": _s("Replace the shot's render prompt.")}, ["shot", "figures"]), "di", None, _WRITE),
    "pose_from_image": (t_pose_from_image, "Pose from an image (uses the GPU pod)",
                        "Find every person in a local image (pose detection on the ComfyUI pod, which must be running and bills while it runs) "
                        "and save each as a pose; with `shot`, pose that shot with them as they stand in the picture. Only use images the user "
                        "has the rights to.",
                        _obj({"image": _s("Absolute path of a PNG/JPEG/WebP on the machine this server runs on.", minLength=1),
                              "shot": {**P_SHOT, "description": "Also pose this shot with the people found."}}, ["image"]), "do", None, _WRITE),
    "render_shot": (t_render_shot, "Render a shot (uses the GPU pod)",
                    "Render a posed shot on ComfyUI (the RunPod pod when the pipeline targets runpod: it uses the GPU and costs money while "
                    "the pod runs). Takes one to several minutes; progress is reported when the client asks for it. Adds a new "
                    "shots/<shot>/out/render_*.png, keeping earlier renders. Ask the user before rendering.",
                    _obj({"shot": P_SHOT, "seed": _i("Fixed seed for a repeatable render (default: random).", minimum=0, maximum=2 ** 53 - 1)},
                         ["shot"]), "o", None, None),
    "place_renders": (t_place_renders, "Place renders into panels",
                      "Put each panel's latest render into a project's panels (panels whose image is locked are left alone).",
                      _obj({"project": P_PROJECT}, ["project"]), "di", None, _WRITE),
    "pod": (t_pod, "GPU pod: status, start, stop",
            "RunPod pod: status (default, free), start (billing begins), or stop (ends GPU billing; a render in flight is lost). "
            "Ask the user before start.",
            _obj({"action": _s("status (default), start or stop.", enum=["status", "start", "stop"])}), "dio", None, None),
    "cast": (t_cast, "Character sheet",
             "Read the character sheet, or with `set` add/update characters by name (other characters are kept). Every shot built later "
             "fills its characters from it.",
             _obj({"set": {"type": "array", "maxItems": 100, "description": "Characters to add or update; omit to only read.",
                           "items": _obj({"name": _s("Name exactly as used in scripts.", minLength=1),
                                          "series": _s("Series or game the character is from (helps the LoRA search)."),
                                          "lora": _s("LoRA file name, `auto` to search Civitai by name and series, or `none`."),
                                          "tags": _s("Danbooru-style appearance tags: hair, eyes, outfit."),
                                          "gender": _s("Body type.", enum=["girl", "boy"]),
                                          "pose": _s("Default pose id from list_poses.")}, ["name"], extra=True)}}), "di", None, _WRITE),
}
SLOW = ("render_shot", "pod", "pose_from_image")      # over HTTP these answer on an SSE stream so proxies see keep-alives


def tool_list(v: str) -> list:
    out = []
    for name, (fn, title, desc, schema, hints, oschema, _lock) in TOOLS.items():   # dict order: the list is stable across calls
        t = {"name": name, "description": desc, "inputSchema": schema}
        if v >= "2025-06-18":
            t["title"] = title
            if oschema:
                t["outputSchema"] = oschema
        if v >= "2025-03-26":
            t["annotations"] = {"title": title, "readOnlyHint": "r" in hints, "destructiveHint": "d" in hints,
                                "idempotentHint": "i" in hints, "openWorldHint": "o" in hints}
        out.append(t)
    return out


# ----------------------------------------------------------------------- argument validation
def _fit(schema: dict, v, path: str, errs: list):
    """The subset of JSON Schema the tool table uses. Returns the value, with numbers that arrived as
    strings (or whole floats for integers) converted, since several clients send those."""
    t = schema.get("type")
    if t == "integer":
        if isinstance(v, str) and re.fullmatch(r"-?\d+", v.strip()):
            v = int(v)
        elif isinstance(v, float) and v.is_integer():
            v = int(v)
        if isinstance(v, bool) or not isinstance(v, int):
            errs.append(f"{path}: expected a whole number")
            return v
    elif t == "number":
        if isinstance(v, str):
            try:
                v = float(v)
            except ValueError:
                pass
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            errs.append(f"{path}: expected a number")
            return v
    elif t == "boolean":
        if isinstance(v, str) and v.lower() in ("true", "false"):
            v = v.lower() == "true"
        if not isinstance(v, bool):
            errs.append(f"{path}: expected true or false")
            return v
    elif t == "string":
        if not isinstance(v, str):
            errs.append(f"{path}: expected a string")
            return v
        if len(v) < schema.get("minLength", 0):
            errs.append(f"{path}: must not be empty")
        if "pattern" in schema and not re.search(schema["pattern"], v):
            errs.append(f"{path}: wrong format. {schema.get('description', '')}".rstrip())
    elif t == "array":
        if not isinstance(v, list):
            errs.append(f"{path}: expected a list")
            return v
        if len(v) < schema.get("minItems", 0):
            errs.append(f"{path}: needs at least {schema['minItems']} item(s)")
        if len(v) > schema.get("maxItems", 1 << 30):
            errs.append(f"{path}: at most {schema['maxItems']} items")
        if "items" in schema:
            v = [_fit(schema["items"], x, f"{path}[{i}]", errs) for i, x in enumerate(v)]
    elif t == "object":
        if not isinstance(v, dict):
            errs.append(f"{path}: expected an object")
            return v
        props = schema.get("properties", {})
        for k in schema.get("required", []):
            if k not in v or v[k] is None:
                errs.append(f"{path + '.' if path else ''}{k}: required")
        out = {}
        for k, x in v.items():
            where = f"{path + '.' if path else ''}{k}"
            if k in props:
                if x is not None:                 # null means "not given", as an omitted optional
                    out[k] = _fit(props[k], x, where, errs)
            elif schema.get("additionalProperties", True) is False:
                errs.append(f"{where}: unknown argument (known: {', '.join(props) or 'none'})")
            else:
                out[k] = x
        v = out
    if "enum" in schema and v not in schema["enum"]:
        errs.append(f"{path}: one of {', '.join(map(str, schema['enum']))}")
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if "minimum" in schema and v < schema["minimum"]:
            errs.append(f"{path}: at least {schema['minimum']}")
        if "maximum" in schema and v > schema["maximum"]:
            errs.append(f"{path}: at most {schema['maximum']}")
    return v


def call_tool(name: str, args, v: str, job: Job) -> dict:
    fn, _title, _desc, schema, _hints, _oschema, lock = TOOLS[name]
    is_err, res = False, None
    errs = []
    args = _fit(schema, {} if args is None else args, "", errs)
    if errs:
        is_err, res = True, f"{name}: invalid arguments\n- " + "\n- ".join(errs[:12])
    else:
        _local.job = job
        try:
            if lock:
                with lock:
                    res = fn(args)
            else:
                res = fn(args)
        except ToolError as e:
            is_err, res = True, str(e)
        except (ValueError, FileNotFoundError, PermissionError) as e:     # the pipeline's own "you asked for something that is not there"
            is_err, res = True, f"{name}: {e}"
        except ImportError as e:
            is_err, res = True, (f"{name}: a Python package is missing ({e}). Install into the interpreter that runs this server: "
                                 f"{sys.executable} -m pip install pyyaml pillow numpy requests")
        except Exception as e:  # noqa: BLE001  the traceback goes to stderr (the client's server log), a readable line to the model
            traceback.print_exc(file=sys.stderr)
            is_err, res = True, f"{name} failed: {type(e).__name__}: {e}"
        finally:
            _local.job = None
    if not is_err and isinstance(res, dict) and res.get("ok") is False:
        is_err = True                                 # the pipeline ran and reported failure: the log says why
    out = {"content": [{"type": "text", "text": res if isinstance(res, str) else json.dumps(res, ensure_ascii=False, indent=1)}], "isError": is_err}
    if isinstance(res, dict) and v >= "2025-06-18" and not (is_err and TOOLS[name][5]):
        out["structuredContent"] = res
    return out


# ------------------------------------------------------------------------ prompts and resources
def _guide() -> str:
    return GUIDE.read_text(encoding="utf-8") if GUIDE.exists() else "(docs/SCRIPT_WIZARD.md is missing from this checkout)"


RULES = ("Rules that matter most: one thing per line; a panel line is `[Name, Name] picture prompt` with the names LEFT TO RIGHT as they "
         "stand; `!` before a panel makes it the page's big moment (one per page at most); dialogue lines (`Name: ...`, `Name (thought): ...`, "
         "`Name (shout): ...`, `Name (whisper): ...`, `Caption: ...`, `SFX: ...`) belong to the panel above; `---` starts a new page; "
         "4 to 6 panels per page, at most 3 characters and 3 short lines per panel; spell each name identically every time; the picture "
         "prompt describes what is SEEN (place, time, action, expression, camera) in short Danbooru-style phrases, never dialogue or "
         "thoughts. All characters are adults.")


def p_write(a: dict) -> str:
    extra = "".join(f"\n{k}: {a[k]}" for k in ("pages", "reading", "cast") if a.get(k))
    return (f"Write a manga script in the KKS-MangaMaker Script Wizard format for this idea:\n\n{a['idea']}\n{extra}\n\n"
            "First list the cast (consistent names, and the series for known characters), then break the story into pages and each page into "
            "panels, then write the script. Give the finished script in one ```text code block with nothing else inside it. If the "
            "kks-mangamaker tools are available, run check_script on it and fix every warning before showing it.\n\n"
            f"{RULES}\n\nThe complete format guide follows.\n\n{_guide()}")


def p_convert(a: dict) -> str:
    return ("Convert the script below into the KKS-MangaMaker Script Wizard format. Keep every scene, every line of dialogue and its speaker, "
            "and the order of events; do not invent story. Turn stage directions and scene descriptions into panel lines "
            "(`[Names left to right] what the picture shows`), split long speeches into bubbles under about 100 characters, move narration "
            "into `Caption:` lines and sound cues into `SFX:` lines, and start a new page with `---` every 4 to 6 panels or at a scene change. "
            "Answer with the converted script in one ```text code block, then a short list of anything you had to guess (who is in a panel, "
            "who stands on the left). If the kks-mangamaker tools are available, run check_script on the result and fix its warnings.\n\n"
            f"{RULES}\n\nThe complete format guide follows.\n\n{_guide()}\n\n--- SCRIPT TO CONVERT ---\n{a['script']}")


def p_storyboard(a: dict) -> str:
    render = str(a.get("render") or "no").strip().lower() in ("yes", "true", "1", "y")
    project = a.get("project") or "(choose a short name from the story: letters, digits, _ and - only)"
    steps = ("5. Rendering was requested: call pod with action status; if the pod is not running, tell the user that starting it begins GPU "
             "billing and wait for their yes before pod start. Then render_shot each shot in page order, place_renders for the project, and "
             "ask whether to pod stop when the renders are done.\n" if render else
             "5. Do NOT call render_shot, pose_from_image or pod start: rendering was not requested (they use the paid GPU pod). "
             "Say that the user can ask for renders later.\n")
    return (f"Storyboard this idea as a manga with the kks-mangamaker tools:\n\n{a['idea']}\n\nProject name: {project}\n\n"
            "1. Call script_format, then write the script (cast first, then pages, then panels).\n"
            "2. check_script; fix every warning.\n"
            "3. cast with `set` to record each character once (name, series, tags, gender), then build_pages_from_script "
            "(reading rtl for manga, a short shot_prefix such as ch1).\n"
            "4. For each shot it created: list_poses by type to pick a pose that fits the panel (a group pose id for two or three people "
            "who interact), then pose_shot with the figures left to right and a framing (full, knees, waist, chest, close) that matches the "
            "panel's camera words.\n"
            f"{steps}"
            "6. Finish by telling the user to open http://127.0.0.1:8765 (./mangapipe-ui), File › Open, to adjust the lettering and export.\n\n"
            f"{RULES}")


# name: (function, title, description, [(argument, description, required)])
PROMPTS = {
    "write_manga_script": (p_write, "Write a manga script", "Write a Script Wizard script from a story idea, outline or chapter summary.",
                           [("idea", "The story idea, outline or scene to script.", True),
                            ("pages", "How many pages (default: as many as the story needs).", False),
                            ("reading", "rtl (manga, default) or ltr.", False),
                            ("cast", "Characters to use, with their series if they are existing characters.", False)]),
    "convert_script_to_wizard_format": (p_convert, "Convert a script to the Script Wizard format",
                                        "Rewrite an existing script (screenplay, prose, chat log, another comic format) into the Script Wizard format.",
                                        [("script", "The script or text to convert.", True)]),
    "storyboard_and_render": (p_storyboard, "Storyboard (and optionally render) a manga",
                              "Script, build the pages, pose every shot, and render them if asked: the whole pipeline with the tools.",
                              [("idea", "The story idea, outline or scene.", True),
                               ("project", "Project name (folder under pages/).", False),
                               ("render", "yes to render on the GPU pod (costs money while it runs); default no.", False)]),
}


def prompt_list(v: str) -> list:
    out = []
    for name, (_fn, title, desc, args) in PROMPTS.items():
        p = {"name": name, "description": desc, "arguments": [{"name": n, "description": d, "required": r} for n, d, r in args]}
        if v >= "2025-06-18":
            p["title"] = title
        out.append(p)
    return out


def prompt_get(params: dict) -> dict:
    spec = PROMPTS.get(params.get("name"))
    if not spec:
        raise RpcError(-32602, f"Unknown prompt: {params.get('name')}", {"prompts": list(PROMPTS)})
    args = params.get("arguments") or {}
    if not isinstance(args, dict):
        raise RpcError(-32602, "prompts/get: arguments must be an object of strings")
    missing = [n for n, _d, req in spec[3] if req and not str(args.get(n) or "").strip()]
    if missing:
        raise RpcError(-32602, f"Missing required argument(s): {', '.join(missing)}")
    return {"description": spec[2], "messages": [{"role": "user", "content": {"type": "text", "text": spec[0]({k: str(x) for k, x in args.items()})}}]}


def resource_list(v: str) -> list:
    r = {"uri": GUIDE_URI, "name": "script-wizard-guide", "mimeType": "text/markdown",
         "description": "The Script Wizard format and how to write a script that lays out and renders well (docs/SCRIPT_WIZARD.md)."}
    if v >= "2025-06-18":
        r["title"] = "Script Wizard guide"
    if GUIDE.exists():
        r["size"] = GUIDE.stat().st_size
    return [r]


def resource_read(params: dict, modern: bool) -> dict:
    uri = params.get("uri")
    if uri != GUIDE_URI or not GUIDE.exists():
        raise RpcError(-32602 if modern else -32002, "Resource not found", {"uri": uri})    # the code moved in 2026-07-28
    return {"contents": [{"uri": GUIDE_URI, "mimeType": "text/markdown", "text": GUIDE.read_text(encoding="utf-8")}]}


# ------------------------------------------------------------------------------- the protocol
class State:
    """What a connection remembers: the handshake version (stdio and the old SSE transport) and its running requests."""

    def __init__(self, stateful: bool):
        self.stateful = stateful
        self.legacy = None                      # set by `initialize`
        self.jobs = {}
        self.lock = threading.Lock()

    def cancel_all(self):
        with self.lock:
            jobs = list(self.jobs.values())
        for j in jobs:
            j.cancel()


def _page(items: list, cursor, key: str) -> dict:
    """Lists here fit one page; a cursor is still honoured so a client that sends one gets a correct answer."""
    start = 0
    if cursor is not None:
        if not (isinstance(cursor, str) and cursor.isdigit() and int(cursor) <= len(items)):
            raise RpcError(-32602, "Invalid cursor")
        start = int(cursor)
    size = 100
    out = {key: items[start:start + size]}
    if start + size < len(items):
        out["nextCursor"] = str(start + size)
    return out


def _capabilities() -> dict:
    return {"tools": {}, "prompts": {}, "resources": {}}       # the lists never change while the server runs: no listChanged


def _header_name(v: str) -> str:
    """Mcp-Name may arrive as =?base64?...?= when the value is not header-safe."""
    if v.startswith("=?base64?") and v.endswith("?="):
        try:
            return base64.b64decode(v[9:-2]).decode("utf-8")
        except Exception:  # noqa: BLE001
            return v
    return v


def _version_of(msg: dict, state: State, headers) -> tuple:
    """(protocol version, modern?) for one request, or raises the error the spec asks for."""
    method = msg.get("method")
    params = msg.get("params") or {}
    meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
    pv = meta.get(META + "protocolVersion")
    hv = headers.get("mcp-protocol-version") if headers is not None else None
    if method == "initialize":
        return None, False
    if pv is not None and pv not in LEGACY or (pv is None and hv in MODERN):
        # the stateless era: everything needed is in the request (and mirrored in headers over HTTP)
        if pv is None:
            raise RpcError(-32602, f"Invalid params: _meta[\"{META}protocolVersion\"] is required", {"supported": list(SUPPORTED)}, 400)
        if pv not in MODERN:
            raise RpcError(-32022, "Unsupported protocol version", {"supported": list(SUPPORTED), "requested": pv}, 400)
        if not isinstance(meta.get(META + "clientCapabilities"), dict):
            raise RpcError(-32602, f"Invalid params: _meta[\"{META}clientCapabilities\"] is required (an object, may be empty)", None, 400)
        if headers is not None:
            if hv != pv:
                raise RpcError(-32020, f"Header mismatch: MCP-Protocol-Version header {hv!r} does not match body value {pv!r}", None, 400)
            if headers.get("mcp-method") != method:
                raise RpcError(-32020, f"Header mismatch: Mcp-Method header {headers.get('mcp-method')!r} does not match body value {method!r}", None, 400)
            want = params.get("uri") if method == "resources/read" else params.get("name") if method in ("tools/call", "prompts/get") else None
            if want is not None and _header_name(headers.get("mcp-name") or "") != want:
                raise RpcError(-32020, f"Header mismatch: Mcp-Name header {headers.get('mcp-name')!r} does not match body value {want!r}", None, 400)
        return pv, True
    if state.stateful:
        if state.legacy is None:
            if method == "ping":
                return LEGACY[0], False
            raise RpcError(-32602, "Not initialized: send `initialize` first (protocol 2025-11-25 and earlier), or put "
                                   f"_meta[\"{META}protocolVersion\"] in every request (2026-07-28)", {"supported": list(SUPPORTED)})
        return state.legacy, False
    if hv is not None and hv not in LEGACY:
        raise RpcError(-32022, "Unsupported protocol version", {"supported": list(SUPPORTED), "requested": hv}, 400)
    return hv or "2025-03-26", False              # no header: what the spec says to assume


def _initialize(msg: dict, state: State) -> dict:
    params = msg.get("params") or {}
    want = params.get("protocolVersion")
    v = want if want in LEGACY else LEGACY[0]     # the client's version when we speak it, else our newest handshake version
    if state.stateful:
        state.legacy = v
    info = {k: SERVER[k] for k in (("name", "title", "version") if v >= "2025-06-18" else ("name", "version"))}
    client = params.get("clientInfo") or {}
    log(f"initialize from {client.get('name', '?')} {client.get('version', '')}: protocol {v}" + ("" if want == v else f" (asked for {want})"))
    return {"protocolVersion": v, "capabilities": _capabilities(), "serverInfo": info, "instructions": INSTRUCTIONS}


def respond(msg: dict, state: State, notify=None, headers=None, job: Job = None):
    """One request in, its reply out: (reply dict, HTTP status). Notifications return (None, 202)."""
    mid, method = msg.get("id"), msg.get("method")
    if "id" not in msg:
        if method == "notifications/cancelled":
            rid = (msg.get("params") or {}).get("requestId") if isinstance(msg.get("params"), dict) else None
            with state.lock:
                j = state.jobs.pop(rid, None) if isinstance(rid, (str, int)) else None
            if j:
                j.cancel()
        return None, 202                          # every other notification (initialized, roots changed, unknown ones) needs nothing
    modern = False
    try:
        params = msg.get("params")
        if params is None:
            params = {}
        if not isinstance(params, dict):
            raise RpcError(-32602, "Invalid params: params must be an object", None, 400 if headers is not None else 200)
        v, modern = _version_of({**msg, "params": params}, state, headers)
        if method == "initialize":
            return {"jsonrpc": "2.0", "id": mid, "result": _initialize(msg, state)}, 200
        cache = None
        if method == "ping" and not modern:       # removed in 2026-07-28
            res = {}
        elif method == "server/discover" and modern:
            res, cache = {"supportedVersions": list(SUPPORTED), "capabilities": _capabilities(), "instructions": INSTRUCTIONS}, 3600000
        elif method == "tools/list":
            res, cache = _page(tool_list(v), params.get("cursor"), "tools"), 3600000
        elif method == "prompts/list":
            res, cache = _page(prompt_list(v), params.get("cursor"), "prompts"), 3600000
        elif method == "prompts/get":
            res = prompt_get(params)
        elif method == "resources/list":
            res, cache = _page(resource_list(v), params.get("cursor"), "resources"), 60000
        elif method == "resources/templates/list":
            res, cache = _page([], params.get("cursor"), "resourceTemplates"), 3600000
        elif method == "resources/read":
            res, cache = resource_read(params, modern), 60000
        elif method == "tools/call":
            name = params.get("name")
            if name not in TOOLS:
                raise RpcError(-32602, f"Unknown tool: {name}", {"tools": list(TOOLS)})
            if params.get("arguments") is not None and not isinstance(params["arguments"], dict):
                raise RpcError(-32602, "Invalid params: arguments must be an object")
            job = job or Job()
            meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
            tok = meta.get("progressToken")
            if isinstance(tok, (str, int)) and not isinstance(tok, bool):
                job.token, job.notify, job.with_message = tok, notify, v >= "2025-03-26"
            if state.stateful:                    # over Streamable HTTP ids are per client, so hanging up is the cancel signal
                with state.lock:
                    state.jobs[mid] = job
            try:
                res = call_tool(name, params.get("arguments"), v, job)
            finally:
                with state.lock:
                    state.jobs.pop(mid, None)
            if job.cancelled.is_set():
                return None, 200                  # a cancelled request gets no reply
        else:
            raise RpcError(-32601, f"Method not found: {method}", None, 404 if modern else 200)
        if modern:
            res["resultType"] = "complete"
            res["_meta"] = {META + "serverInfo": SERVER}
            if cache is not None:                 # nothing here depends on who asks
                res["ttlMs"], res["cacheScope"] = cache, "public"
        return {"jsonrpc": "2.0", "id": mid, "result": res}, 200
    except RpcError as e:
        return _failed(mid, e), (e.status if headers is not None else 200)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc(file=sys.stderr)
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": f"Internal error: {type(e).__name__}: {e}"}}, 200


def _error(code: int, message: str, mid=None) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


def _failed(mid, e: RpcError) -> dict:
    err = {"code": e.code, "message": e.message}
    if e.data is not None:
        err["data"] = e.data
    return {"jsonrpc": "2.0", "id": mid, "error": err}


def _precheck(msg: dict, state: State, headers=None):
    """Version and header checks alone, for requests that are answered on a stream: (modern?, error reply, status)."""
    try:
        params = msg.get("params")
        if params is not None and not isinstance(params, dict):
            raise RpcError(-32602, "Invalid params: params must be an object", None, 400)
        _v, modern = _version_of({**msg, "params": params or {}}, state, headers)
        if msg["method"] == "tools/call" and (params or {}).get("name") not in TOOLS:
            raise RpcError(-32602, f"Unknown tool: {(params or {}).get('name')}", {"tools": list(TOOLS)})
        return modern, None, 200
    except RpcError as e:
        return False, _failed(msg.get("id"), e), (e.status if headers is not None else 200)


def _shape(msg):
    """None when `msg` is a request or notification we can route; 'skip' for a client's response; else the error reply."""
    if not isinstance(msg, dict):
        return _error(-32600, "Invalid Request: expected a JSON object")
    if "method" not in msg and ("result" in msg or "error" in msg):
        return "skip"                             # this server sends no requests, so there is nothing to match it to
    mid = msg.get("id")
    ok_id = isinstance(mid, (str, int)) and not isinstance(mid, bool)
    if msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        return _error(-32600, "Invalid Request: needs \"jsonrpc\": \"2.0\" and a string \"method\"", mid if ok_id else None)
    if "id" in msg and not ok_id:
        return _error(-32600, "Invalid Request: id must be a string or an integer")
    return None


def _listen(msg: dict, notify) -> bool:
    """subscriptions/listen (2026-07-28): acknowledge with the notification types we will send, which is none,
    because the tool, prompt and resource lists never change while the server runs."""
    notify({"jsonrpc": "2.0", "method": "notifications/subscriptions/acknowledged",
            "params": {"_meta": {META + "subscriptionId": msg["id"]}, "notifications": {}}})
    return True


class Channel:
    """A single ordered stream both ways (stdio, or one session of the old SSE transport): requests may arrive
    while a tool call runs, so tool calls go to worker threads and everything else is answered in line."""

    def __init__(self, send):
        self.send = send
        self.state = State(stateful=True)
        self.workers = set()

    def _reply(self, msg: dict):
        reply, _ = respond(msg, self.state, notify=self.send)
        if reply is not None:
            self.send(reply)

    def _work(self, msg: dict):
        try:
            self._reply(msg)
        finally:
            self.workers.discard(threading.current_thread())

    def _one(self, msg):
        """Reply (or None) for one message of a batch, or of a line."""
        bad = _shape(msg)
        if bad == "skip":
            return None
        if bad:
            return bad
        if msg.get("method") == "subscriptions/listen" and "id" in msg:
            modern, bad, _ = _precheck(msg, self.state)
            if bad:
                return bad
            if modern:
                with self.state.lock:
                    self.state.jobs[msg["id"]] = Job()   # held open until notifications/cancelled names it
                _listen(msg, self.send)
                return None
        if msg.get("method") == "tools/call" and "id" in msg:
            t = threading.Thread(target=self._work, args=(msg,), daemon=True, name=f"tool-{msg['id']}")
            self.workers.add(t)
            t.start()
            return None
        reply, _ = respond(msg, self.state, notify=self.send)
        return reply

    def feed(self, raw):
        """One line (stdio) or one POST body (old SSE transport)."""
        try:
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8-sig")     # a BOM on the first line is tolerated, never written
            msg = json.loads(raw)
        except (ValueError, UnicodeDecodeError) as e:
            self.send(_error(-32700, f"Parse error: {e}"))
            return
        if isinstance(msg, list):
            if self.state.legacy != "2025-03-26":      # the only revision with JSON-RPC batches
                self.send(_error(-32600, "Invalid Request: batches exist only in protocol 2025-03-26 (after initialize); send one message per line"))
                return
            if not msg:
                self.send(_error(-32600, "Invalid Request: empty batch"))
                return
            # tool calls inside a batch run in line so the answers can go back as one array
            out = []
            for m in msg:
                bad = _shape(m)
                if bad == "skip":
                    continue
                r = bad or respond(m, self.state, notify=self.send)[0]
                if r is not None:
                    out.append(r)
            if out:
                self.send(out)
            return
        reply = self._one(msg)
        if reply is not None:
            self.send(reply)

    def drain(self, grace: float):
        """After the client closed its side: let running calls finish for a moment, then stop them."""
        end = time.time() + grace
        for t in list(self.workers):
            t.join(max(0.0, end - time.time()))
        self.state.cancel_all()


# ----------------------------------------------------------------------------------- stdio
def _wire(obj) -> bytes:
    return (json.dumps(obj, ensure_ascii=True, separators=(",", ":")) + "\n").encode("ascii")    # \uXXXX escapes: one line, any code page


def serve_stdio():
    # Keep the protocol stream to ourselves: fd 1 becomes stderr for everything else in this process and its
    # children (imports that print, C libraries, the pipeline), and only `out` writes to the client.
    sys.stdout.flush()
    out = os.fdopen(os.dup(1), "wb", buffering=0)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    lock = threading.Lock()

    def send(obj):
        data = _wire(obj)
        with lock:
            try:
                out.write(data)
            except (BrokenPipeError, OSError):       # the client is gone; the read loop ends on its own
                pass

    ch = Channel(send)

    def stop(*_):
        ch.state.cancel_all()
        raise SystemExit(0)
    for sig in ("SIGTERM", "SIGINT", "SIGHUP"):
        if hasattr(signal, sig):
            try:
                signal.signal(getattr(signal, sig), stop)
            except (ValueError, OSError):
                pass
    log(f"stdio, protocol {', '.join(SUPPORTED)}, python {sys.version.split()[0]}")
    stdin = sys.stdin.buffer
    while True:
        line = stdin.readline()
        if not line:
            break                                 # EOF: the client closed our input, which is how it asks us to leave
        if line.strip():
            ch.feed(line)
    ch.drain(30)


# ------------------------------------------------------------------------------------ HTTP
LOOPBACK = ("localhost", "127.0.0.1", "::1")


def _host_only(hostport: str) -> str:
    h = (hostport or "").strip().lower()
    if h.startswith("["):
        return h[1:h.find("]")] if "]" in h else h
    return h.rsplit(":", 1)[0] if h.count(":") == 1 else h


class Http(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, token, hosts, origins):
        if ":" in addr[0]:
            self.address_family = socket.AF_INET6
        super().__init__(addr, Handler)
        self.token, self.hosts, self.origins = token, hosts, origins
        self.wild = addr[0] in ("0.0.0.0", "::", "")
        self.state = State(stateful=False)        # Streamable HTTP keeps no session: each POST stands alone
        self.sessions = {}                        # old SSE transport: session id -> (Channel, queue)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "kks-mangamaker-mcp"
    sys_version = ""

    def log_message(self, fmt, *args):
        log("http " + fmt % args)

    # -- answers
    def _send(self, status: int, body=None, headers=None, ctype="application/json"):
        data = b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=True, separators=(",", ":")).encode("ascii"))
        self.send_response(status)
        if data:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, x in {**self._cors(), **(headers or {})}.items():
            self.send_header(k, x)
        self.end_headers()
        if data and self.command != "HEAD":
            self.wfile.write(data)

    def _cors(self) -> dict:
        o = self.headers.get("Origin")
        return {"Access-Control-Allow-Origin": o, "Vary": "Origin", "Access-Control-Expose-Headers": "WWW-Authenticate"} if o else {}

    def _guard(self) -> bool:
        """DNS-rebinding and access checks, before anything is read: Host, Origin, then the bearer token."""
        srv = self.server
        host = _host_only(self.headers.get("Host", ""))
        is_ip = bool(re.fullmatch(r"[0-9]+(\.[0-9]+){3}|[0-9a-f]*:[0-9a-f:.]+", host))
        if not (host in LOOPBACK or host in srv.hosts or (srv.wild and is_ip)):
            self._send(403, _error(-32600, f"Forbidden: Host {host!r} is not allowed (start the server with --allow-host {host})"))
            return False
        origin = self.headers.get("Origin")
        if origin is not None:
            o = urlparse(origin)
            if not ((o.scheme in ("http", "https") and (o.hostname or "") in LOOPBACK) or origin.rstrip("/").lower() in srv.origins):
                self._send(403, _error(-32600, f"Forbidden: Origin {origin!r} is not allowed (start the server with --allow-origin {origin})"))
                return False
        if srv.token and self.command != "OPTIONS":
            got = self.headers.get("Authorization", "")
            if not (got[:7].lower() == "bearer " and hmac.compare_digest(got[7:].strip().encode(), srv.token.encode())):
                self._send(401, _error(-32600, "Unauthorized: send Authorization: Bearer <token>"), {"WWW-Authenticate": 'Bearer realm="kks-mangamaker"'})
                return False
        return True

    def _body(self):
        try:
            n = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._send(411, _error(-32600, "Length Required"))
            return None
        if n > 16 << 20:
            self._send(413, _error(-32600, "Request body too large"), {"Connection": "close"})
            self.close_connection = True
            return None
        return self.rfile.read(n)

    # -- SSE
    def _sse_open(self):
        self.send_response(200)
        for k, x in {"Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "close",
                     "X-Accel-Buffering": "no", **self._cors()}.items():
            self.send_header(k, x)
        self.end_headers()
        self.close_connection = True              # no Content-Length: the end of the stream is the end of the connection

    def _sse(self, obj=None, event: str = "message", text: str = None):
        if obj is None and text is None:
            data = b": keep-alive\n\n"
        else:
            data = f"event: {event}\ndata: {text if text is not None else json.dumps(obj, ensure_ascii=True, separators=(',', ':'))}\n\n".encode("ascii")
        self.wfile.write(data)
        self.wfile.flush()

    def _gone(self) -> bool:
        """Has the client hung up? (Readable with nothing to read: it sent FIN. Nothing else arrives on a stream.)"""
        try:
            if not select.select([self.connection], [], [], 0)[0]:
                return False
            return self.connection.recv(1, socket.MSG_PEEK) == b""
        except (OSError, ValueError):
            return True

    def _pump(self, q, done=None):
        """Copy messages from `q` to the stream until `done` arrives or the client leaves; a comment line every 15 s
        keeps proxies from closing a quiet stream."""
        quiet = time.time()
        while True:
            try:
                item = q.get(timeout=0.5)
            except queue.Empty:
                if self._gone():
                    raise ConnectionError("client closed the stream")
                if time.time() - quiet >= 15:
                    self._sse()
                    quiet = time.time()
                continue
            if item is done and done is not None:
                return
            self._sse(item)
            quiet = time.time()

    def _stream(self, msg: dict, headers: dict, listen: bool = False):
        """Answer one request on an SSE stream: progress as it happens, keep-alives while it is quiet, the reply
        last. A client that hangs up cancels the request, which is the transport's cancellation signal."""
        self._sse_open()
        q = queue.Queue()
        job = Job()
        done = object()

        def run():
            try:
                if listen:
                    _listen(msg, q.put)
                    job.cancelled.wait()
                else:
                    reply, _ = respond(msg, self.server.state, notify=q.put, headers=headers, job=job)
                    if reply is not None:
                        q.put(reply)
            finally:
                q.put(done)
        threading.Thread(target=run, daemon=True, name=f"http-{msg.get('id')}").start()
        try:
            self._pump(q, done)
        except (BrokenPipeError, ConnectionError, OSError):
            log(f"client left during {msg.get('method')} {msg.get('id')}: cancelling")
        finally:
            job.cancel()

    # -- methods
    def do_OPTIONS(self):
        if not self._guard():
            return
        self._send(204, None, {"Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Max-Age": "600",
                               "Access-Control-Allow-Headers": self.headers.get("Access-Control-Request-Headers", "Content-Type, Authorization")})

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if not self._guard():
            return
        if path == "/mcp":
            # no server-initiated stream: the lists never change and nothing is sent outside a request
            self._send(405, _error(-32600, "Method Not Allowed: POST JSON-RPC to /mcp (the old HTTP+SSE transport is at /sse)"), {"Allow": "POST, OPTIONS"})
        elif path == "/sse":
            self._old_sse()
        else:
            self._send(404, _error(-32600, "Not Found: the MCP endpoint is /mcp"))

    do_HEAD = do_GET

    def do_DELETE(self):
        if self._guard():
            self._send(405, _error(-32600, "Method Not Allowed: there are no sessions to end"), {"Allow": "POST, OPTIONS"})

    do_PUT = do_PATCH = do_DELETE

    def do_POST(self):
        u = urlparse(self.path)
        path = u.path.rstrip("/") or "/"
        if not self._guard():
            return
        if path == "/messages":
            return self._old_post(parse_qs(u.query).get("session_id", [""])[0])
        if path != "/mcp":
            return self._send(404, _error(-32600, "Not Found: the MCP endpoint is /mcp"))
        if "json" not in (self.headers.get("Content-Type") or "application/json").lower():
            return self._send(415, _error(-32600, "Unsupported Media Type: Content-Type must be application/json"))
        accept = (self.headers.get("Accept") or "*/*").lower()
        if not any(t in accept for t in ("application/json", "text/event-stream", "*/*", "application/*")):
            return self._send(406, _error(-32600, "Not Acceptable: Accept must list application/json and text/event-stream"))
        raw = self._body()
        if raw is None:
            return
        try:
            msg = json.loads(raw.decode("utf-8-sig"))
        except (ValueError, UnicodeDecodeError) as e:
            return self._send(400, _error(-32700, f"Parse error: {e}"))
        headers = {k.lower(): x for k, x in self.headers.items()}
        state = self.server.state
        if isinstance(msg, list):
            if headers.get("mcp-protocol-version", "2025-03-26") != "2025-03-26" or not msg:
                return self._send(400, _error(-32600, "Invalid Request: batches exist only in protocol 2025-03-26; send one message per POST"))
            out = []
            for m in msg:
                bad = _shape(m)
                if bad == "skip":
                    continue
                r = bad or respond(m, state, headers=headers)[0]
                if r is not None:
                    out.append(r)
            return self._send(200, out) if out else self._send(202)
        bad = _shape(msg)
        if bad == "skip":
            return self._send(202)
        if bad:
            return self._send(400, bad)
        if "id" not in msg:
            respond(msg, state, headers=headers)
            return self._send(202)
        sse_ok = "text/event-stream" in accept
        params = msg.get("params") if isinstance(msg.get("params"), dict) else {}
        meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
        if msg["method"] in ("subscriptions/listen", "tools/call"):
            modern, bad, status = _precheck(msg, state, headers)
            if bad:
                return self._send(status, bad)
            if msg["method"] == "subscriptions/listen" and modern:
                if not sse_ok:
                    return self._send(406, _error(-32600, "Not Acceptable: subscriptions/listen answers with text/event-stream", msg["id"]))
                return self._stream(msg, headers, listen=True)
            if msg["method"] == "tools/call" and sse_ok and (meta.get("progressToken") is not None or params.get("name") in SLOW):
                return self._stream(msg, headers)
        reply, status = respond(msg, state, headers=headers)
        if reply is None:
            return self._send(202)
        self._send(status, reply)

    # -- the deprecated HTTP+SSE transport (2024-11-05): GET /sse opens the stream, POST /messages feeds it
    def _old_sse(self):
        sid = secrets.token_urlsafe(24)
        q = queue.Queue()
        ch = Channel(q.put)
        self.server.sessions[sid] = (ch, q)
        self._sse_open()
        try:
            self._sse(event="endpoint", text=f"/messages?session_id={sid}")
            self._pump(q)
        except (BrokenPipeError, ConnectionError, OSError):
            pass
        finally:
            self.server.sessions.pop(sid, None)
            ch.state.cancel_all()

    def _old_post(self, sid: str):
        s = self.server.sessions.get(sid)
        if not s:
            return self._send(404, _error(-32600, "Unknown session: open GET /sse first and POST to the endpoint it announces"))
        raw = self._body()
        if raw is None:
            return
        self._send(202, b"Accepted", ctype="text/plain")
        s[0].feed(raw)                             # replies travel on the session's SSE stream


def serve_http(a):
    token = a.token or os.environ.get("MANGAMAKER_MCP_TOKEN") or ""
    hosts = {h.strip().lower() for h in (a.allow_host or []) + os.environ.get("MANGAMAKER_MCP_ALLOW_HOST", "").split(",") if h.strip()}
    origins = {o.strip().rstrip("/").lower() for o in (a.allow_origin or []) + os.environ.get("MANGAMAKER_MCP_ALLOW_ORIGIN", "").split(",") if o.strip()}
    local = a.host in LOOPBACK
    if (not local or hosts) and not token:
        sys.stderr.write("mangamaker-mcp: refusing to listen beyond this machine without a token.\n"
                         "  These tools write files here and can start the GPU pod, which costs money.\n"
                         "  Pass --token <secret> (or set MANGAMAKER_MCP_TOKEN); clients then send `Authorization: Bearer <secret>`.\n")
        return 2
    if token and len(token) < 16:
        sys.stderr.write("mangamaker-mcp: the token is too short; use at least 16 random characters, e.g. `python3 -c \"import secrets; print(secrets.token_urlsafe(32))\"`\n")
        return 2
    if not local:
        hosts.add(a.host.lower())
    sys.stdout = sys.stderr                        # nothing here speaks on stdout; keep prints with the log
    try:
        httpd = Http((a.host, a.port), token, hosts, origins)
    except OSError as e:
        sys.stderr.write(f"mangamaker-mcp: cannot listen on {a.host}:{a.port}: {e}\n")
        return 1

    def stop(*_):
        raise KeyboardInterrupt
    for sig in ("SIGTERM", "SIGHUP"):
        if hasattr(signal, sig):
            try:
                signal.signal(getattr(signal, sig), stop)
            except (ValueError, OSError):
                pass
    shown = f"[{a.host}]" if ":" in a.host else a.host
    log(f"Streamable HTTP on http://{shown}:{a.port}/mcp (old HTTP+SSE: /sse), protocol {', '.join(SUPPORTED)}, "
        f"{'bearer token required' if token else 'no token (loopback only)'}")
    try:
        httpd.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.state.cancel_all()
        for ch, _q in list(httpd.sessions.values()):
            ch.state.cancel_all()
        httpd.server_close()
    return 0


# ------------------------------------------------------------------------------------ main
def missing_deps() -> list:
    return [pip for mod, pip in DEPS if importlib.util.find_spec(mod) is None]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="mangamaker-mcp", description="KKS-MangaMaker MCP server. No arguments: stdio. See docs/MCP.md.")
    ap.add_argument("--http", action="store_true", help="serve Streamable HTTP at /mcp instead of stdio")
    ap.add_argument("--host", default="127.0.0.1", help="address to bind with --http (default 127.0.0.1; anything else needs --token)")
    ap.add_argument("--port", type=int, default=8766, help="port for --http (default 8766)")
    ap.add_argument("--token", help="bearer token clients must send (or env MANGAMAKER_MCP_TOKEN)")
    ap.add_argument("--allow-host", action="append", metavar="NAME", help="extra Host header to accept, e.g. your tunnel's hostname (repeatable; needs --token)")
    ap.add_argument("--allow-origin", action="append", metavar="ORIGIN", help="extra browser Origin to accept, e.g. https://app.example (repeatable)")
    ap.add_argument("--no-deps-check", action="store_true", help="start even when PyYAML, Pillow or numpy are missing (most tools will fail)")
    ap.add_argument("--version", action="version", version=f"{SERVER['name']} {SERVER['version']} (MCP {', '.join(SUPPORTED)})")
    a = ap.parse_args(argv)
    if sys.version_info < (3, 9):
        sys.stderr.write(f"mangamaker-mcp: Python 3.9 or newer is needed; {sys.executable} is {sys.version.split()[0]}. Set MANGAPIPE_PYTHON to a newer one.\n")
        return 1
    for s in (sys.stdin, sys.stdout, sys.stderr):  # Windows code pages: the protocol and the log are UTF-8, newlines are \n
        try:
            s.reconfigure(encoding="utf-8", errors="replace", newline="\n")
        except (AttributeError, ValueError, OSError):
            pass
    gone = missing_deps()
    if gone and not a.no_deps_check:
        sys.stderr.write(f"mangamaker-mcp: {sys.executable} is missing: {', '.join(gone)}\n"
                         f"  install them:  {sys.executable} -m pip install pyyaml pillow numpy requests\n"
                         "  or point the launcher at the interpreter that has them:  MANGAPIPE_PYTHON=/path/to/python\n")
        return 1
    if a.http:
        return serve_http(a)
    serve_stdio()
    return 0


if __name__ == "__main__":
    sys.exit(main())
