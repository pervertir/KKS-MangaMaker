"""Chapter source format (project.json version 2): every panel carries the scene that makes its render.

A version 1 editor document only points each panel at a finished picture. Version 2 adds, per panel:

    "scene":  {                       everything `mangapipe run` needs, so the page re-renders from JSON alone
        "shot": "ch1_p01_1",          the shot folder this scene is written to (a render cache, see below)
        "prompt": "...", "negative": "", "style": "flat_anime", "identity": "auto",
        "seed": 3726344714,           always a real seed once rendered: the same scene gives the same picture
        "characters": [...],          the shot.yaml characters (name, series, lora, lora_weight, tags, gender)
        "options": {...},             any other shot.yaml keys (width, height, steps, cfg, head_inpaint, ...)
        "pose": {"w", "h", "chars"}   the Pose tab scene (pose ids, placement, yaw, joint edits), or null when
                                      the pose came from a Studio capture (then "pose_image" names the png)
    },
    "motion": null,                   reserved for living panels (keyframes, loop, tier); see docs/CHAPTER_FORMAT.md
    "render": {"hash": "...", "still": "mp:shots/.../render_123_00.png", "seed": 123}
                                      which scene produced the panel's picture; a different hash = stale

and the document gains "cast": the characters the chapter uses, copied from cast.json, so a chapter
file is complete on another machine.

Shot folders stay the working format of the renderer, the Pose tab and the MCP server. The JSON is
the source: `mangapipe chapter render` writes a changed scene into its shot folder and renders it, and
`mangapipe chapter sync` (also run by the editor on open) pulls edits made in a shot folder back in.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
from pathlib import Path
from typing import Callable

import yaml

from .sidecar import SIDECAR_NAMES

VERSION = 2
# shot.yaml keys that are files or page lettering, not part of what gets rendered
_NOT_SCENE = {"shot", "pose", "reference", "dialogue", "depth"}
_TOP = ("prompt", "negative", "style", "identity", "seed", "characters")
SEED_RE = re.compile(r"render_(\d+)_\d+\.png$")


class ChapterError(Exception):
    pass


# ------------------------------------------------------------------------------- scenes
def _sidecar(d: Path) -> Path | None:
    return next((d / n for n in SIDECAR_NAMES if (d / n).exists()), None)


def renders(d: Path) -> list[Path]:
    out = d / "out"
    if not out.exists():
        return []
    return sorted((p for p in out.glob("render_*.png") if not p.stem.endswith("_base")), key=lambda p: p.stat().st_mtime)


def scene_from_shot(d: Path) -> dict | None:
    """A shot folder as a scene, or None when the folder has no sidecar."""
    side = _sidecar(d)
    if side is None:
        return None
    text = side.read_text(encoding="utf-8")
    data = (json.loads(text) if side.suffix == ".json" else yaml.safe_load(text)) or {}
    scene = {"shot": d.name}
    for k in _TOP:
        if k in data and data[k] is not None:
            scene[k] = data[k]
    scene.setdefault("prompt", "")
    scene.setdefault("characters", [])
    opts = {k: v for k, v in data.items() if k not in _NOT_SCENE and k not in _TOP and v is not None}
    if opts:
        scene["options"] = opts
    ps = d / "pose_scene.json"
    if ps.exists():
        pose = json.loads(ps.read_text(encoding="utf-8") or "{}")
        pose.pop("prompt", None)
        pose.pop("shot", None)
        scene["pose"] = pose or None
    else:
        scene["pose"] = None
    if scene["pose"] is None and (d / "pose.png").exists():
        scene["pose_image"] = f"mp:shots/{d.name}/pose.png"
    if int(scene.get("seed", -1) or -1) < 0:             # an unseeded shot that already rendered: keep that picture's seed
        rs = renders(d)
        m = SEED_RE.search(rs[-1].name) if rs else None
        if m:
            scene["seed"] = int(m.group(1))
    return scene


def scene_hash(scene: dict | None, motion: dict | None = None) -> str:
    """What decides the picture. `shot` is only where it is cached, so it is left out."""
    if not scene:
        return ""
    body = {k: v for k, v in scene.items() if k != "shot"}
    return hashlib.sha1(json.dumps([body, motion], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def write_scene(scene: dict, d: Path, poses: dict | None = None) -> None:
    """Scene -> shot folder: shot.yaml, pose_scene.json and, when the pose library is given, pose.png."""
    d.mkdir(parents=True, exist_ok=True)
    side = {"shot": d.name, "pose": "pose.png"}
    if (d / "reference.png").exists():
        side["reference"] = "reference.png"
    for k in _TOP:
        if k in scene:
            side[k] = scene[k]
    side.update(scene.get("options") or {})
    side["dialogue"] = []
    old = _sidecar(d)
    if old is not None and old.suffix == ".json":
        old.unlink()
    head = "# Written from the chapter JSON by `mangapipe chapter`; edit the panel's scene there (or here, then `chapter sync`).\n"
    (d / "shot.yaml").write_text(head + yaml.safe_dump(side, sort_keys=False, allow_unicode=True, width=1000), encoding="utf-8")
    pose = scene.get("pose")
    if pose:
        (d / "pose_scene.json").write_text(json.dumps({**pose, "prompt": scene.get("prompt", ""), "shot": d.name}, indent=1), encoding="utf-8")
        if poses is not None:
            from .poserender import render
            missing = [c["pose"] for c in pose.get("chars", []) if not c.get("hidden") and c.get("pose") not in poses]
            if missing:
                raise ChapterError(f"{d.name}: pose(s) not in the library: {', '.join(missing)}")
            render(pose, poses).save(d / "pose.png")
    elif not (d / "pose.png").exists():
        raise ChapterError(f"{d.name}: the scene has no pose and the shot has no pose.png")


# ---------------------------------------------------------------------------- documents
def panels(doc: dict):
    """(page number, panel number, layer) for every panel, in page order."""
    for pi, pg in enumerate(doc.get("pages", []), start=1):
        k = 0
        for l in pg.get("layers", []):
            if l.get("type") == "panel":
                k += 1
                yield pi, k, l


def _cast(doc: dict, cast: list[dict]) -> None:
    names = {c.get("name") for _, _, l in panels(doc) for c in ((l.get("scene") or {}).get("characters") or []) if isinstance(c, dict)}
    have = {c.get("name") for c in doc.get("cast", [])}
    doc["cast"] = doc.get("cast", []) + [c for c in cast if c.get("name") in names and c.get("name") not in have]


def sync(doc: dict, shots: Path, cast: list[dict] | None = None, newer_than: float | None = None) -> list[str]:
    """Upgrade a document to version 2 and pull scenes in from shot folders. A panel takes its shot's
    scene when it has none, when its shot changed, or when the shot folder was edited after
    `newer_than` (the project file's mtime) and differs. Returns the shots pulled in."""
    pulled = []
    for _, _, l in panels(doc):
        name = l.get("shot")
        if not name:
            continue
        d = shots / name
        if not d.is_dir():
            continue
        have = l.get("scene")
        if have and have.get("shot") == name:
            if newer_than is None:
                continue
            files = [p for p in (_sidecar(d), d / "pose_scene.json") if p is not None and p.exists()]
            if not files or max(p.stat().st_mtime for p in files) <= newer_than:
                continue
        sc = scene_from_shot(d)
        if sc is None or scene_hash(sc) == scene_hash(have):
            continue
        l["scene"] = sc
        l.setdefault("motion", None)
        if l.get("render") is None or not have:
            img = (l.get("image") or {}).get("ref", "")
            m = SEED_RE.search(img)
            if img and m and int(m.group(1)) == int(sc.get("seed", -1) or -1):   # the picture on the panel is this scene's
                l["render"] = {"hash": scene_hash(sc, l.get("motion")), "still": img, "seed": int(m.group(1))}
        pulled.append(name)
    doc["version"] = max(VERSION, int(doc.get("version", 1)))
    if cast is not None:
        _cast(doc, cast)
    return pulled


def stale(doc: dict) -> list[tuple[int, int, dict]]:
    """Panels whose scene differs from what made their picture (or that have no picture yet)."""
    out = []
    for pi, k, l in panels(doc):
        sc = l.get("scene")
        if not sc:
            continue
        r = l.get("render") or {}
        if r.get("hash") != scene_hash(sc, l.get("motion")) or not l.get("image"):
            out.append((pi, k, l))
    return out


def render_chapter(doc: dict, project: str, root: Path, poses: dict, render_shot: Callable[[Path, int], list[Path]],
                   pages: list[int] | None = None, dry_run: bool = False, log=print) -> list[str]:
    """Write each stale panel's scene into its shot folder and render it; put the new picture on the
    panel and record which scene made it. `render_shot(shot_dir, seed)` does the rendering."""
    from PIL import Image

    from .workflow import new_seed

    done = []
    todo = [t for t in stale(doc) if not pages or t[0] in pages]
    if not todo:
        log("[chapter] every panel is up to date")
    for pi, k, l in todo:
        sc = l["scene"]
        if not sc.get("shot"):
            sc["shot"] = l.get("shot") or f"{re.sub(r'[^A-Za-z0-9_-]+', '_', project)}_p{pi:02d}_{k}"
        l["shot"] = sc["shot"]
        if int(sc.get("seed", -1) or -1) < 0:
            sc["seed"] = new_seed(-1)
        d = root / "shots" / sc["shot"]
        log(f"[chapter] page {pi} panel {k}: {sc['shot']} (seed {sc['seed']})" + ("  [dry run]" if dry_run else ""))
        if dry_run:
            continue
        if scene_hash(scene_from_shot(d)) != scene_hash(sc):
            write_scene(sc, d, poses)
        files = render_shot(d, int(sc["seed"]))
        if not files:
            raise ChapterError(f"{sc['shot']}: the render produced no image")
        f = files[0]
        with Image.open(f) as im:
            iw, ih = im.size
        ref = "mp:" + f.resolve().relative_to(root.resolve()).as_posix()
        keep = l.get("image") or {}
        l["image"] = {"ref": ref, "iw": iw, "ih": ih, "fit": keep.get("fit", "cover"), "focus": keep.get("focus", [0.5, 0.3]),
                      "zoom": keep.get("zoom", 1), "flip": keep.get("flip", False)}
        l["render"] = {"hash": scene_hash(sc, l.get("motion")), "still": ref, "seed": int(sc["seed"])}
        done.append(sc["shot"])
    return done


def load(path: Path) -> dict:
    if not path.exists():
        raise ChapterError(f"no project at {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def save(doc: dict, path: Path) -> None:
    buf = io.StringIO()
    json.dump(doc, buf, indent=1, ensure_ascii=False)
    path.write_text(buf.getvalue(), encoding="utf-8")
