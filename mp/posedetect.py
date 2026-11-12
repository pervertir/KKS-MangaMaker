"""Pose from an image: DWPose (comfyui_controlnet_aux) on the pod finds every person's body and hand
keypoints; this turns each person into a library pose (metres, floor at 0, hips centred) plus where they
stand in the picture, so the Pose tab can add them as editable figures over the image."""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import requests

PARENT = {0: 1, 2: 1, 3: 2, 4: 3, 5: 1, 6: 5, 7: 6, 8: 1, 9: 8, 10: 9, 11: 1, 12: 11, 13: 12, 14: 0, 15: 0, 16: 14, 17: 15}
NECK_TO_HIPS_M = 0.47      # the library skeleton's neck-to-hip-centre length
FIG_H = 1.75


def _graph(image_name: str, prefix: str) -> dict:
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {"class_type": "DWPreprocessor", "inputs": {"image": ["1", 0], "detect_hand": "enable", "detect_body": "enable", "detect_face": "disable",
                                                         "resolution": 1024, "bbox_detector": "yolox_l.onnx", "pose_estimator": "dw-ll_ucoco_384_bs5.torchscript.pt"}},
        "3": {"class_type": "SavePoseKpsAsJsonFile", "inputs": {"pose_kps": ["2", 1], "filename_prefix": prefix}},
        "4": {"class_type": "PreviewImage", "inputs": {"images": ["2", 0]}},
    }


def detect(comfy, image: Path, log=print) -> list[dict]:
    """OpenPose-format frames for the image: [{people: [...], canvas_width, canvas_height}]."""
    name = comfy.upload(image, "manga", f"posedetect_{int(time.time())}{image.suffix or '.png'}")
    prefix = f"MangaPipeline/posedetect_{int(time.time())}"
    hist = comfy.wait(comfy.queue(_graph(name, prefix)), timeout=600)
    # the JSON lands in ComfyUI's output folder; ask for it by name
    sub, base = prefix.rsplit("/", 1)
    for i in range(1, 6):
        for fn in (f"{base}_{i:05d}.json", f"{base}_{i:05d}_.json", f"{base}.json"):
            r = requests.get(f"{comfy.url}/view", params={"filename": fn, "subfolder": sub, "type": "output"}, timeout=60)
            if r.status_code == 200 and r.content.strip().startswith((b"[", b"{")):
                data = json.loads(r.content)
                return data if isinstance(data, list) else [data]
    raise RuntimeError("DWPose ran but its keypoint file was not found on the pod (" + json.dumps(hist.get("outputs", {}))[:300] + ")")


def _pts(flat, n, W, H):
    out = []
    flat = flat or []
    for i in range(n):
        if 3 * i + 2 < len(flat):
            x, y, c = flat[3 * i: 3 * i + 3]
            if c and c > 0.05 and (x or y):
                if x <= 1.0 and y <= 1.0:            # normalised coordinates
                    x, y = x * W, y * H
                out.append([float(x), float(y)])
                continue
        out.append(None)
    return out


def person_to_pose(person: dict, W: int, H: int) -> dict | None:
    body = _pts(person.get("pose_keypoints_2d"), 18, W, H)
    if sum(p is not None for p in body) < 5:
        return None
    if body[1] is None and body[2] and body[5]:
        body[1] = [(body[2][0] + body[5][0]) / 2, (body[2][1] + body[5][1]) / 2]
    if body[1] is None:
        return None
    # scale: neck to hips if both hips were found, else shoulder width (~0.22 m), else the figure's height
    hips = [p for p in (body[8], body[11]) if p]
    if hips:
        hx, hy = sum(p[0] for p in hips) / len(hips), sum(p[1] for p in hips) / len(hips)
        k = math.hypot(hx - body[1][0], hy - body[1][1]) / NECK_TO_HIPS_M
    elif body[2] and body[5]:
        k = math.hypot(body[2][0] - body[5][0], body[2][1] - body[5][1]) / 0.22
        hx, hy = body[1][0], body[1][1] + NECK_TO_HIPS_M * k
    else:
        ys = [p[1] for p in body if p]
        k = max(1.0, (max(ys) - min(ys)) / 1.4)
        hx, hy = body[1][0], body[1][1] + NECK_TO_HIPS_M * k
    k = max(k, 1.0)
    # missing joints sit on their parent (a zero-length bone draws nothing wrong); hips default under the neck
    for i in (8, 11):
        if body[i] is None:
            body[i] = [hx + (-0.08 if i == 8 else 0.08) * k, hy]
    for _ in range(3):
        for i, par in PARENT.items():
            if body[i] is None and body[par] is not None:
                body[i] = list(body[par])
    hands = []
    for key, wrist in (("hand_left_keypoints_2d", 7), ("hand_right_keypoints_2d", 4)):
        hp = _pts(person.get(key), 21, W, H)
        base = body[wrist]
        hands.append([p or base for p in hp] if sum(p is not None for p in hp) >= 6 else [base] * 21)
    floor = max(p[1] for p in body + hands[0] + hands[1])
    to3 = lambda p: [round((p[0] - hx) / k, 3), round((floor - p[1]) / k, 3), 0.0]  # noqa: E731
    return {"body": [to3(p) for p in body], "hands": [[to3(p) for p in hd] for hd in hands],
            "place": {"x": round(hx / W, 4), "y": round(floor / H, 4), "scale": round(k * FIG_H / H, 4)}}


def poses_from_image(comfy, image: Path, log=print) -> dict:
    from PIL import Image
    with Image.open(image) as im:
        W, H = im.size
    frames = detect(comfy, image, log)
    fr = frames[0] if frames else {}
    W2, H2 = int(fr.get("canvas_width") or W), int(fr.get("canvas_height") or H)
    people = [p for p in (person_to_pose(q, W2, H2) for q in fr.get("people", [])) if p]
    people.sort(key=lambda p: p["place"]["x"])           # left to right, like the character list
    return {"w": W, "h": H, "people": people}
