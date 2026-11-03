"""Studio-side helpers: grab the latest F11 renders, prepare the pose image for ControlNet."""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

from .workflow import pick_size

RENDER_GLOB = "CharaStudio-*-Render.png"


def latest_renders(cap_dir: Path, n: int = 2) -> list[Path]:
    files = sorted(cap_dir.glob(RENDER_GLOB), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:n]


def flatten(img: Image.Image, bg=(0, 0, 0)) -> Image.Image:
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        img = img.convert("RGBA")
        base = Image.new("RGBA", img.size, bg + (255,))
        base.alpha_composite(img)
        return base.convert("RGB")
    return img.convert("RGB")


def grab(cap_dir: Path, shot_dir: Path, pose_src: Path | None = None, ref_src: Path | None = None, log=print) -> dict:
    """Copy the newest Render png as pose.png (and the one before it as reference.png when present).

    Order in Studio: F11 the real character first (reference), then swap to the OpenPose card and F11 again (pose).
    """
    shot_dir.mkdir(parents=True, exist_ok=True)
    if pose_src is None:
        latest = latest_renders(cap_dir, 2)
        if not latest:
            raise FileNotFoundError(f"no {RENDER_GLOB} in {cap_dir}")
        pose_src = latest[0]
        if ref_src is None and len(latest) > 1 and not (shot_dir / "reference.png").exists():
            ref_src = latest[1]
    out = {}
    pose = flatten(Image.open(pose_src), (0, 0, 0))
    pose.save(shot_dir / "pose.png")
    out["pose"] = pose_src
    log(f"[grab] pose      <- {pose_src.name}")
    if ref_src is not None:
        ref = flatten(Image.open(ref_src), (128, 128, 128))
        ref.save(shot_dir / "reference.png")
        out["reference"] = ref_src
        log(f"[grab] reference <- {ref_src.name}")
    return out


def prepare_pose(pose_path: Path, out_path: Path, size: tuple[int, int] | None) -> tuple[int, int]:
    """Flatten onto black, fit into the target SDXL size with black padding. Returns (w, h)."""
    img = flatten(Image.open(pose_path), (0, 0, 0))
    if size is None:
        size = pick_size(*img.size)
    w, h = size
    scale = min(w / img.width, h / img.height)
    nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    fitted = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (w, h), (0, 0, 0))
    canvas.paste(fitted, ((w - nw) // 2, (h - nh) // 2))
    canvas.save(out_path)
    return w, h


def prepare_reference(ref_path: Path, out_path: Path, crop=None) -> None:
    """Optional crop [x, y, w, h] as fractions, then save RGB."""
    img = flatten(Image.open(ref_path), (128, 128, 128))
    if crop:
        x, y, w, h = crop
        if max(crop) <= 1.0:
            x, y, w, h = x * img.width, y * img.height, w * img.width, h * img.height
        img = img.crop((int(x), int(y), int(x + w), int(y + h)))
    if max(img.size) > 1536:
        img.thumbnail((1536, 1536), Image.LANCZOS)
    img.save(out_path)
