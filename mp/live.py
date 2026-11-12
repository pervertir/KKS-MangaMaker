"""Live Manga layers: the background with nobody in it, and each character on its own, cut out.

For a posed shot (pose_scene.json from the Pose tab) this renders, into shots/<shot>/live/:

    bg_<seed>.png                 the scene without characters (no pose ControlNet, no LoRAs)
    actor_<char id>_<seed>.png    one character in its scene pose, on a plain background, then cut
                                  out with SAM 3 (RGBA)

Every layer has the size of the panel's still render and uses the same pose framing, so in the editor
the cutouts sit exactly where the characters stand in the still, and the editor can warp each one
along its OpenPose keyframes (ui/web/src/editor/live.js) without rendering anything per frame.

Shot keys that steer it (all optional):
    live_bg_prompt: "empty classroom at sunset"     the background prompt; default: the shot prompt
    live_actor_prompt: "..."                        extra words for each character render
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

import numpy as np
import requests
from PIL import Image

BG_NEG = "1girl, 1boy, person, people, human, character, crowd, figure, silhouette"
ACTOR_BG = "simple background, white background, full body"
ACTOR_NEG = "scenery, detailed background, multiple people, 2girls, 2boys"


def _seed(shot: dict) -> int:
    from .chapter import SEED_RE, renders
    s = int(shot.get("seed", -1) or -1)
    if s >= 0:
        return s
    rs = renders(shot["_dir"])
    m = SEED_RE.search(rs[-1].name) if rs else None
    if m:
        return int(m.group(1))
    from .workflow import new_seed
    return new_seed(-1)


def _size(shot: dict) -> tuple[int, int] | None:
    from .chapter import renders
    if shot.get("width") and shot.get("height"):
        return int(shot["width"]), int(shot["height"])
    rs = renders(shot["_dir"])
    if rs:
        with Image.open(rs[-1]) as im:
            return im.size
    return None


def cutout(comfy, image: Path, cfg, out: Path, prompt: str = "person", threshold: float = 0.3) -> Path:
    """RGBA copy of `image` keeping only what SAM 3 finds for `prompt` (all hits merged)."""
    name = comfy.upload(image, "manga", image.name)
    g = {
        "1": {"class_type": "LoadImage", "inputs": {"image": name}},
        "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": cfg.get("sam_checkpoint", "sam3.1_multiplex_fp16.safetensors")}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 1], "text": prompt}},
        "4": {"class_type": "SAM3_Detect", "inputs": {"model": ["2", 0], "image": ["1", 0], "conditioning": ["3", 0],
              "threshold": threshold, "refine_iterations": 2, "individual_masks": False}},
        "5": {"class_type": "MaskToImage", "inputs": {"mask": ["4", 0]}},
        "6": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "MangaPipeline/_masks/actor"}},
    }
    hist = comfy.wait(comfy.queue(g))
    mask = None
    for o in hist.get("outputs", {}).values():
        for img in o.get("images", []):
            r = requests.get(f"{comfy.url}/view", params={"filename": img["filename"], "subfolder": img.get("subfolder", ""),
                                                          "type": img.get("type", "output")}, timeout=120)
            r.raise_for_status()
            import io
            m = np.array(Image.open(io.BytesIO(r.content)).convert("L"))
            mask = m if mask is None else np.maximum(mask, m)
    if mask is None or (mask > 127).sum() < 256:
        raise RuntimeError(f"SAM 3 found no {prompt!r} in {image.name}")
    with Image.open(image) as im:
        rgba = im.convert("RGBA")
    a = Image.fromarray(mask).resize(rgba.size, Image.BILINEAR)
    rgba.putalpha(a)
    rgba.save(out)
    return out


def render_layers(shot: dict, cfg, render: Callable[[dict, int], list[Path]], comfy=None, chars: list[str] | None = None,
                  dry_run: bool = False, log=print) -> dict:
    """Render the background and the cutouts for a loaded shot (mp.sidecar.load_shot).
    `render(shot, seed)` runs one render and returns its images. Returns {"bg": path, "actors": {id: path}}."""
    from .poserender import render as draw_pose
    d: Path = shot["_dir"]
    ps = d / "pose_scene.json"
    if not ps.exists():
        raise ValueError(f"{d.name}: no pose_scene.json; pose the shot in the Pose tab first (live layers need the skeletons)")
    scene = json.loads(ps.read_text(encoding="utf-8"))
    live = d / "live"
    live.mkdir(exist_ok=True)
    seed, size = _seed(shot), _size(shot)
    base = {**shot, "_reference_path": None, "_depth_path": None, "head_inpaint": False, "seed": seed}
    if size:
        base["width"], base["height"] = size
    out = {"bg": None, "actors": {}}

    def one(sh: dict, dest: Path) -> Path | None:
        sub = live / ("_" + dest.stem)
        sub.mkdir(exist_ok=True)
        files = render({**sh, "_out": sub}, seed)
        if dry_run or not files:
            return None
        files[0].replace(dest)
        return dest

    # background: no characters, the pose ControlNet off
    bg = {**base, "characters": [], "identity": "none", "count_tag": "no humans", "controlnet_strength": 0.0,
          "prompt": ", ".join(p for p in [shot.get("live_bg_prompt") or shot.get("prompt", ""), "scenery, background"] if p),
          "negative": ", ".join(p for p in [shot.get("negative", ""), BG_NEG] if p)}
    if chars is None or "bg" in chars:
        log(f"[live] background (seed {seed})")
        out["bg"] = one(bg, live / f"bg_{seed}.png")

    # characters: the shot's characters are in left-to-right order of the visible figures
    vis = sorted([c for c in scene.get("chars", []) if not c.get("hidden")], key=lambda c: c.get("x", 0.5))
    poses = None
    for i, c in enumerate(vis):
        if chars is not None and c["id"] not in chars:
            continue
        if poses is None:
            import sys
            sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ui"))
            from server import pose_library  # the editor's library: basics, studio, H, custom
            poses = {p["id"]: p for p in pose_library()["poses"]}
        solo = {**scene, "chars": [{**q, "hidden": q["id"] != c["id"]} for q in scene["chars"]]}
        pose_png = live / f"pose_{c['id']}.png"
        draw_pose(solo, poses).save(pose_png)
        who = shot["characters"][i] if i < len(shot["characters"]) else {"name": c.get("name", ""), "series": c.get("series", ""),
                                                                           "tags": c.get("tags", ""), "lora": "auto", "lora_weight": 0.8,
                                                                           "trigger": "", "generic": not c.get("name")}
        actor = {**base, "characters": [who], "_pose_path": pose_png,
                 "prompt": ", ".join(p for p in [shot.get("prompt", ""), shot.get("live_actor_prompt", ""), ACTOR_BG] if p),
                 "negative": ", ".join(p for p in [shot.get("negative", ""), ACTOR_NEG] if p)}
        log(f"[live] {who.get('name') or c.get('label', 'character')} ({c['id']})")
        flat = one(actor, live / f"actor_{c['id']}_{seed}_flat.png")
        if flat is None:
            continue
        if comfy is None:
            raise RuntimeError("no ComfyUI connection for the cutout")
        out["actors"][c["id"]] = cutout(comfy, flat, cfg, live / f"actor_{c['id']}_{seed}.png")
        log(f"[live] cut out -> {out['actors'][c['id']].name}")
    return out


def latest(d: Path) -> dict:
    """Newest background and newest cutout per character in shots/<shot>/live/."""
    live = d / "live"
    if not live.is_dir():
        return {"bg": None, "actors": {}}
    by_time = lambda pat: sorted(live.glob(pat), key=lambda p: p.stat().st_mtime)
    bgs = by_time("bg_*.png")
    actors: dict[str, Path] = {}
    for p in by_time("actor_*_*.png"):
        if p.stem.endswith("_flat"):
            continue
        cid = p.stem[len("actor_"):].rsplit("_", 1)[0]
        actors[cid] = p
    return {"bg": bgs[-1] if bgs else None, "actors": actors}
