"""Build MangaPipeline's graphs as ComfyUI UI workflows (the format the Workflows sidebar opens).

    python3 docker/make_ui_workflows.py --url https://<pod>-8188.proxy.runpod.net --out docker/workflows

Node inputs and widget order come from the server's /object_info, so the files match the installed
nodes. Writes:
  MangaPipeline - pose.json         OpenPose (union ControlNet) + character LoRA + IPAdapter reference
  MangaPipeline - pose+depth.json   adds a depth pass on the same union ControlNet and an act LoRA,
                                    for multi-character contact scenes (docker/WORKFLOW.md)
Images are loaded from ComfyUI's input/ folder: pose.png, depth.png, reference.png.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests

STYLE_POS = ("masterpiece, best quality, amazing quality, very aesthetic, absurdres, anime screencap, flat color, "
             "cel shading, clean bold lineart, vivid colors, high contrast, simple shading, sharp focus")
STYLE_NEG = ("lowres, worst quality, low quality, bad anatomy, bad hands, missing fingers, extra digits, fewer digits, "
             "jpeg artifacts, blurry, signature, watermark, username, speech bubble, text, logo, 3d, realistic, "
             "photorealistic, washed out, pale, desaturated, child, loli, petite")


def api_graph(depth: bool) -> dict:
    g = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "waiIllustriousSDXL_v160.safetensors"}},
        "20": {"class_type": "LoraLoader", "inputs": {"model": ["1", 0], "clip": ["1", 1],
               "lora_name": "civitai_characters/DX888HinataV3.safetensors", "strength_model": 0.75, "strength_clip": 0.75}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["20", 1], "text":
              STYLE_POS + ", 1girl, solo, mature female, adult, uzumaki hinata, hyuuga hinata, standing, smile, looking at viewer"}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["20", 1], "text": STYLE_NEG}},
        "4": {"class_type": "LoadImage", "inputs": {"image": "pose.png"}},
        "5": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "xinsir_controlnet_union-sdxl-1-promax.safetensors"}},
        "6": {"class_type": "SetUnionControlNetType", "inputs": {"control_net": ["5", 0], "type": "openpose"}},
        "7": {"class_type": "ControlNetApplyAdvanced", "inputs": {"positive": ["2", 0], "negative": ["3", 0], "control_net": ["6", 0],
              "image": ["4", 0], "strength": 0.9, "start_percent": 0.0, "end_percent": 0.85, "vae": ["1", 2]}},
        "8": {"class_type": "LoadImage", "inputs": {"image": "reference.png"}},
        "9": {"class_type": "PrepImageForClipVision", "inputs": {"image": ["8", 0], "interpolation": "LANCZOS",
              "crop_position": "top", "sharpening": 0.0}},
        "10": {"class_type": "IPAdapterModelLoader", "inputs": {"ipadapter_file": "ip-adapter-plus_sdxl_vit-h.safetensors"}},
        "11": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": "clip_vision_h.safetensors"}},
        "12": {"class_type": "IPAdapterAdvanced", "inputs": {"model": ["20", 0], "ipadapter": ["10", 0], "image": ["9", 0],
               "weight": 0.35, "weight_type": "linear", "combine_embeds": "concat", "start_at": 0.0, "end_at": 0.9,
               "embeds_scaling": "V only", "clip_vision": ["11", 0]}},
        "13": {"class_type": "EmptyLatentImage", "inputs": {"width": 832, "height": 1216, "batch_size": 4}},
        "14": {"class_type": "KSampler", "inputs": {"model": ["12", 0], "positive": ["7", 0], "negative": ["7", 1],
               "latent_image": ["13", 0], "seed": 12345, "steps": 26, "cfg": 5.5, "sampler_name": "euler_ancestral",
               "scheduler": "normal", "denoise": 1.0}},
        "15": {"class_type": "VAEDecode", "inputs": {"samples": ["14", 0], "vae": ["1", 2]}},
        "16": {"class_type": "SaveImage", "inputs": {"images": ["15", 0], "filename_prefix": "MangaPipeline/ui/render"}},
    }
    if depth:
        g["21"] = {"class_type": "LoraLoader", "inputs": {"model": ["20", 0], "clip": ["20", 1],
                   "lora_name": "civitai_concepts/missionary-v8-illustriousxl-lora-nochekaiser.safetensors",
                   "strength_model": 0.6, "strength_clip": 0.6}}
        for n in ("2", "3"):
            g[n]["inputs"]["clip"] = ["21", 1]
        g["12"]["inputs"]["model"] = ["21", 0]
        g["2"]["inputs"]["text"] = STYLE_POS + ", 1girl, 1boy, mature female, adult, uzumaki hinata, hyuuga hinata, uzumaki naruto, adult, couple"
        g["7"]["inputs"].update(strength=0.7, end_percent=0.6)
        g["17"] = {"class_type": "LoadImage", "inputs": {"image": "depth.png"}}
        g["18"] = {"class_type": "SetUnionControlNetType", "inputs": {"control_net": ["5", 0], "type": "depth"}}
        g["19"] = {"class_type": "ControlNetApplyAdvanced", "inputs": {"positive": ["7", 0], "negative": ["7", 1],
                   "control_net": ["18", 0], "image": ["17", 0], "strength": 0.5, "start_percent": 0.0,
                   "end_percent": 0.5, "vae": ["1", 2]}}
        g["14"]["inputs"].update(positive=["19", 0], negative=["19", 1])
    return g


def is_widget(spec) -> bool:
    t, opts = spec[0], (spec[1] if len(spec) > 1 else {})
    if opts.get("forceInput"):
        return False
    return isinstance(t, list) or t in ("INT", "FLOAT", "STRING", "BOOLEAN", "COMBO")


def to_ui(api: dict, info: dict) -> dict:
    ids = {k: i + 1 for i, k in enumerate(api)}
    depth = {}

    def d(k):
        if k not in depth:
            ups = [v[0] for v in api[k]["inputs"].values() if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str)]
            depth[k] = 1 + max((d(u) for u in ups), default=-1)
        return depth[k]

    nodes, links, rows = {}, [], {}
    for k, n in api.items():
        cls = info[n["class_type"]]
        req, opt = cls["input"].get("required", {}), cls["input"].get("optional", {})
        order = cls.get("input_order", {})
        names = order.get("required", list(req)) + order.get("optional", list(opt))
        specs = {**req, **opt}
        col = d(k)
        row = rows.get(col, 0)
        rows[col] = row + 1
        node = {"id": ids[k], "type": n["class_type"], "pos": [40 + col * 380, 40 + row * 300], "size": [340, 200],
                "flags": {}, "order": 0, "mode": 0, "inputs": [], "outputs": [],
                "properties": {"Node name for S&R": n["class_type"]}, "widgets_values": []}
        for name in names:
            spec = specs[name]
            val = n["inputs"].get(name)
            if is_widget(spec):
                node["widgets_values"].append(val if val is not None else (spec[1] or {}).get("default"))
                if name in ("seed", "noise_seed"):
                    node["widgets_values"].append("fixed")
                if n["class_type"] == "LoadImage" and name == "image":
                    node["widgets_values"].append("image")
            elif name in n["inputs"] or name in req:
                node["inputs"].append({"name": name, "type": spec[0] if isinstance(spec[0], str) else "COMBO", "link": None})
        for i, (t, nm) in enumerate(zip(cls["output"], cls.get("output_name", cls["output"]))):
            node["outputs"].append({"name": nm, "type": t, "links": [], "slot_index": i})
        nodes[k] = node
    for k, n in api.items():
        for name, v in n["inputs"].items():
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                lid = len(links) + 1
                src, slot = v[0], v[1]
                dst = nodes[k]
                to_slot = next(i for i, x in enumerate(dst["inputs"]) if x["name"] == name)
                dst["inputs"][to_slot]["link"] = lid
                nodes[src]["outputs"][slot]["links"].append(lid)
                links.append([lid, ids[src], slot, ids[k], to_slot, dst["inputs"][to_slot]["type"]])
    for i, k in enumerate(sorted(api, key=d)):
        nodes[k]["order"] = i
    return {"last_node_id": len(ids), "last_link_id": len(links), "nodes": list(nodes.values()), "links": links,
            "groups": [], "config": {}, "extra": {"ds": {"scale": 0.7, "offset": [0, 0]}}, "version": 0.4}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "workflows"))
    a = ap.parse_args()
    info = requests.get(a.url.rstrip("/") + "/object_info", timeout=120).json()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, depth in (("MangaPipeline - pose", False), ("MangaPipeline - pose+depth", True)):
        api = api_graph(depth)
        missing = sorted({n["class_type"] for n in api.values()} - set(info))
        if missing:
            raise SystemExit(f"server lacks nodes: {missing}")
        (out / f"{name}.json").write_text(json.dumps(to_ui(api, info), indent=1))
        (out / f"{name}.api.json").write_text(json.dumps(api, indent=1))
        print("wrote", out / f"{name}.json")


if __name__ == "__main__":
    main()
