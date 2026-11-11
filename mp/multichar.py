"""Multi-character shots: find each head in the base render with SAM 3 (core ComfyUI SAM3_Detect),
sort the heads left to right so characters[i] is the i-th figure from the left, then re-inpaint each
head (face + hair) with only that character's LoRA at full weight.

The base render runs with every character's LoRA at a reduced weight (multi_lora_base_scale), so the
bodies and outfits come out roughly right and the faces don't blend; this pass fixes the identities.
Only core ComfyUI nodes are used.
"""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import requests
from PIL import Image


def detect_heads(comfy, image_name: str, cfg, out_dir: Path, prompt: str = "head", threshold: float = 0.4) -> list[dict]:
    """[{"box": (x0, y0, x1, y1), "mask": Path}] for each head found, sorted left to right."""
    g = {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": cfg.get("sam_checkpoint", "sam3.1_multiplex_fp16.safetensors")}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 1], "text": prompt}},
        "4": {"class_type": "SAM3_Detect", "inputs": {"model": ["2", 0], "image": ["1", 0], "conditioning": ["3", 0],
              "threshold": threshold, "refine_iterations": 2, "individual_masks": True}},
        "5": {"class_type": "MaskToImage", "inputs": {"mask": ["4", 0]}},
        "6": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": "MangaPipeline/_masks/head"}},
    }
    hist = comfy.wait(comfy.queue(g))
    heads = []
    for out in hist.get("outputs", {}).values():
        for i, img in enumerate(out.get("images", [])):
            r = requests.get(f"{comfy.url}/view", params={"filename": img["filename"], "subfolder": img.get("subfolder", ""),
                                                          "type": img.get("type", "output")}, timeout=120)
            r.raise_for_status()
            p = out_dir / f"head_mask_{i:02d}.png"
            p.write_bytes(r.content)
            m = np.array(Image.open(p).convert("L")) > 127
            if m.sum() < 64:
                continue
            ys, xs = np.nonzero(m)
            heads.append({"box": (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1), "mask": p})
    heads.sort(key=lambda h: (h["box"][0] + h["box"][2]) / 2)
    return heads


def pose_columns(pose_path: Path, n: int) -> list[tuple[int, int]] | None:
    """Split the pose capture into n left-to-right columns, one per skeleton. None if it can't find n."""
    a = np.array(Image.open(pose_path).convert("L")) > 40
    cols = a.any(axis=0)
    runs, x = [], 0
    while x < len(cols):
        if cols[x]:
            s = x
            while x < len(cols) and cols[x]:
                x += 1
            runs.append([s, x])
        x += 1
    while len(runs) > n:  # merge the two runs with the smallest gap (a skeleton's own limbs)
        i = min(range(len(runs) - 1), key=lambda k: runs[k + 1][0] - runs[k][1])
        runs[i:i + 2] = [[runs[i][0], runs[i + 1][1]]]
    if len(runs) != n:
        return None
    w = a.shape[1]
    cuts = [0] + [(runs[k][1] + runs[k + 1][0]) // 2 for k in range(n - 1)] + [w]
    return [(cuts[k], cuts[k + 1]) for k in range(n)]


def _crop_box(box, img_w: int, img_h: int, pad: float) -> tuple[int, int, int, int]:
    """Square-ish crop around a head box, padded, clamped, sides a multiple of 8. (x, y, w, h)."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    side = max(x1 - x0, y1 - y0) * pad
    side = int(min(max(side, 128), img_w, img_h)) // 8 * 8
    x = int(min(max(cx - side / 2, 0), img_w - side))
    y = int(min(max(cy - side / 2, 0), img_h - side))
    return x, y, side, side


def build_refine_graph(shot: dict, cfg, base_name: str, size: tuple[int, int], jobs: list[dict], seed: int) -> dict:
    """jobs: [{"lora", "weight", "prompt", "mask_name", "crop": (x, y, w, h)}] applied in order."""
    g = {}
    nid = [0]

    def add(class_type, **inputs):
        nid[0] += 1
        g[str(nid[0])] = {"class_type": class_type, "inputs": inputs}
        return str(nid[0])

    style = cfg.style(shot.get("style", "flat_anime"))
    ckpt = add("CheckpointLoaderSimple", ckpt_name=cfg["checkpoint"])
    img = [add("LoadImage", image=base_name), 0]
    target = int(shot.get("head_inpaint_size", 1024))
    for j, job in enumerate(jobs):
        x, y, w, h = job["crop"]
        model, clip = [ckpt, 0], [ckpt, 1]
        if job["lora"]:
            lo = add("LoraLoader", model=model, clip=clip, lora_name=job["lora"],
                     strength_model=float(job["weight"]), strength_clip=float(job["weight"]))
            model, clip = [lo, 0], [lo, 1]
        pos = add("CLIPTextEncode", clip=clip, text=", ".join(p for p in [style["positive"], job.get("who", "1girl") + ", solo, portrait, face focus",
                                                                        job["prompt"], shot.get("head_prompt", "")] if p))
        neg = add("CLIPTextEncode", clip=clip, text=", ".join(p for p in [style["negative"], shot.get("negative", "")] if p))
        crop = add("ImageCrop", image=img, width=w, height=h, x=x, y=y)
        up = add("ImageScale", image=[crop, 0], upscale_method="lanczos", width=target, height=target, crop="disabled")
        lat = add("VAEEncode", pixels=[up, 0], vae=[ckpt, 2])
        mask = add("LoadImageMask", image=job["mask_name"], channel="red")
        mcrop = add("CropMask", mask=[mask, 0], x=x, y=y, width=w, height=h)
        grow = add("GrowMask", mask=[mcrop, 0], expand=max(4, w // 24), tapered_corners=True)
        feather = add("FeatherMask", mask=[grow, 0], left=w // 16, top=w // 16, right=w // 16, bottom=w // 16)
        noised = add("SetLatentNoiseMask", samples=[lat, 0], mask=[grow, 0])
        ks = add("KSampler", model=model, positive=[pos, 0], negative=[neg, 0], latent_image=[noised, 0], seed=seed + j,
                 steps=int(shot["steps"]), cfg=float(shot["cfg"]), sampler_name=shot["sampler"], scheduler=shot["scheduler"],
                 denoise=float(shot.get("head_denoise", 0.5)))
        dec = add("VAEDecode", samples=[ks, 0], vae=[ckpt, 2])
        down = add("ImageScale", image=[dec, 0], upscale_method="lanczos", width=w, height=h, crop="disabled")
        comp = add("ImageCompositeMasked", destination=img, source=[down, 0], x=x, y=y, resize_source=False, mask=[feather, 0])
        img = [comp, 0]
    add("SaveImage", images=img, filename_prefix=f"MangaPipeline/{shot['shot']}/refined")
    return g


def refine_heads(comfy, shot: dict, cfg, loras: list[dict], prompt_parts: list[str], render: Path, seed: int, log=print) -> Path | None:
    """Inpaint every character's head with its own LoRA. Returns the refined image, or None if skipped."""
    out = shot["_out"]
    base_name = comfy.upload(render, "manga", f"{shot['shot']}_{render.stem}_base.png")
    chars = shot["characters"]
    # SAM 3 returns one object per prompt unless told how many ("head:N"); keep the N biggest heads.
    heads = detect_heads(comfy, base_name, cfg, out, f'{shot.get("head_prompt_detect", "head")}:{len(chars) + 3}')
    heads = sorted(sorted(heads, key=lambda h: -(h["box"][2] - h["box"][0]) * (h["box"][3] - h["box"][1]))[:len(chars)],
                   key=lambda h: (h["box"][0] + h["box"][2]) / 2)
    log(f"[heads] found {len(heads)} for {len(chars)} character(s), left to right: " + ", ".join(str(h["box"]) for h in heads))
    if not heads:
        log("[heads] none found; keeping the base render")
        return None
    if len(heads) != len(chars):
        log(f"[heads] count differs from characters[]; matching the {min(len(heads), len(chars))} leftmost")
    W, H = Image.open(render).size
    jobs = []
    for i, (c, l, h) in enumerate(zip(chars, loras, heads)):
        mask_name = comfy.upload(h["mask"], "manga", f"{shot['shot']}_{render.stem}_head{i}.png")
        jobs.append({"lora": l["lora"], "weight": float(c.get("lora_weight", l["weight"])), "prompt": prompt_parts[i],
                     "who": "1boy" if str(c.get("gender", "girl")).lower() in ("boy", "male", "man") else "1girl",
                     "mask_name": mask_name, "crop": _crop_box(h["box"], W, H, float(shot.get("head_crop_pad", 1.8)))})
    g = build_refine_graph(shot, cfg, base_name, (W, H), jobs, seed)
    problems = comfy.validate(g)
    if problems:
        raise RuntimeError("head inpaint graph invalid: " + "; ".join(problems))
    t0 = time.time()
    hist = comfy.wait(comfy.queue(g))
    files = comfy.download_outputs(hist, out, f"{render.stem}_heads")
    log(f"[heads] inpainted {len(jobs)} head(s) in {time.time() - t0:.0f}s -> {files[0].name if files else 'nothing'}")
    return files[0] if files else None
