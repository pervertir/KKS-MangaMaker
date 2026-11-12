"""Character mattes: cut the people out of a render with SAM 3 on the pod (core ComfyUI SAM3_Detect, the
model the multi-character head pass already uses), so the editor can let them break out of a panel frame.

The matte is saved next to the render as out/matte_<render stem>.png: white, the alpha channel is the
union of every person found (slightly grown and softened so hair edges don't fringe).
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

import numpy as np
import requests
from PIL import Image, ImageFilter


def matte_path(render: Path) -> Path:
    return render.with_name(f"matte_{render.stem}.png")


def make_matte(comfy, render: Path, cfg, prompt: str = "person", threshold: float = 0.35, log=print) -> Path:
    name = comfy.upload(render, "manga", f"{render.parent.parent.name}_{render.stem}_matte_src.png")
    g = {
        "1": {"class_type": "LoadImage", "inputs": {"image": name}},
        "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": cfg.get("sam_checkpoint", "sam3.1_multiplex_fp16.safetensors")}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 1], "text": prompt}},
        "4": {"class_type": "SAM3_Detect", "inputs": {"model": ["2", 0], "image": ["1", 0], "conditioning": ["3", 0],
              "threshold": threshold, "refine_iterations": 2, "individual_masks": True}},
        "5": {"class_type": "MaskToImage", "inputs": {"mask": ["4", 0]}},
        "6": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "MangaPipeline/_masks/matte"}},
    }
    problems = comfy.validate(g)
    if problems:
        raise RuntimeError("matte graph invalid (run `mangapipe pod setup` to install SAM 3.1): " + "; ".join(problems))
    hist = comfy.wait(comfy.queue(g))
    with Image.open(render) as im:
        size = im.size
    acc = np.zeros((size[1], size[0]), dtype=np.uint8)
    n = 0
    for out in hist.get("outputs", {}).values():
        for img in out.get("images", []):
            r = requests.get(f"{comfy.url}/view", params={"filename": img["filename"], "subfolder": img.get("subfolder", ""),
                                                          "type": img.get("type", "output")}, timeout=120)
            r.raise_for_status()
            m = Image.open(BytesIO(r.content)).convert("L")
            if m.size != size:
                m = m.resize(size, Image.BILINEAR)
            a = np.array(m)
            if (a > 127).sum() < 256:
                continue
            acc = np.maximum(acc, a)
            n += 1
    if not n:
        raise RuntimeError(f"no {prompt} found in {render.name}")
    alpha = Image.fromarray(acc).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.2))
    out = Image.new("RGBA", size, (255, 255, 255, 0))
    out.putalpha(alpha)
    dest = matte_path(render)
    out.save(dest)
    log(f"[matte] {n} {prompt} mask(s) -> {dest.name}")
    return dest
