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


# Person detectors disagree badly on drawn and anime figures (big heads, flat colour), so every one runs
# and the people they find are merged: DWPose with three person detectors, plain OpenPose (no person
# detector), and on wide pictures DWPose over overlapping vertical strips, each read as one person.
DW = "dw-ll_ucoco_384_bs5.torchscript.pt"
DETECTORS = [
    ("DWPreprocessor", {"bbox_detector": "yolox_l.torchscript.pt", "pose_estimator": DW}, 1024),
    ("DWPreprocessor", {"bbox_detector": "yolo_nas_l_fp16.onnx", "pose_estimator": DW}, 1024),
    ("DWPreprocessor", {"bbox_detector": "yolo_nas_m_fp16.onnx", "pose_estimator": DW}, 512),
    ("OpenposePreprocessor", {}, 768),
]
MIN_POINTS = 9          # a person needs this many confident body points to count


def _graph(image_name: str, prefix: str, node: str, extra: dict, res: int = 1024) -> dict:
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {"class_type": node, "inputs": {"image": ["1", 0], "detect_hand": "enable", "detect_body": "enable", "detect_face": "disable",
                                             "resolution": res, **extra}},
        "3": {"class_type": "SavePoseKpsAsJsonFile", "inputs": {"pose_kps": ["2", 1], "filename_prefix": prefix}},
        "4": {"class_type": "PreviewImage", "inputs": {"images": ["2", 0]}},
    }


def _run(comfy, name, node, extra, res):
    prefix = f"MangaPipeline/posedetect_{int(time.time() * 1000)}"
    return _fetch(comfy, prefix, comfy.wait(comfy.queue(_graph(name, prefix, node, extra, res)), timeout=600))


def _confident(p) -> int:
    k = p.get("pose_keypoints_2d") or []
    return sum(1 for i in range(18) if 3 * i + 2 < len(k) and (k[3 * i + 2] or 0) > 0.05)


def _anchor(p, W, H):
    """Neck (or the mean of the confident points), in pixels."""
    k = p.get("pose_keypoints_2d") or []
    pts = [(k[3 * i], k[3 * i + 1]) for i in range(18) if 3 * i + 2 < len(k) and (k[3 * i + 2] or 0) > 0.05]
    if len(k) > 5 and (k[5] or 0) > 0.05:
        pts = [(k[3], k[4])]
    x, y = sum(q[0] for q in pts) / len(pts), sum(q[1] for q in pts) / len(pts)
    return (x * W, y * H) if x <= 1 and y <= 1 else (x, y)


def _box(p, W, H):
    k = p.get("pose_keypoints_2d") or []
    pts = [(k[3 * i], k[3 * i + 1]) for i in range(18) if 3 * i + 2 < len(k) and (k[3 * i + 2] or 0) > 0.05]
    pts = [(x * W, y * H) if x <= 1 and y <= 1 else (x, y) for x, y in pts]
    xs, ys = [q[0] for q in pts], [q[1] for q in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _overlap(p, q, W, H) -> float:
    """Intersection over the smaller outline."""
    a, b = _box(p, W, H), _box(q, W, H)
    iw, ih = max(0, min(a[2], b[2]) - max(a[0], b[0])), max(0, min(a[3], b[3]) - max(a[1], b[1]))
    small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])) or 1
    return iw * ih / small


def _shift(p, dx, sx, W, cw, CH, H):
    """Move a person found in a strip (cw x CH) back into the full picture (W x H), in pixels."""
    q = dict(p)
    for key in ("pose_keypoints_2d", "hand_left_keypoints_2d", "hand_right_keypoints_2d"):
        k = list(p.get(key) or [])
        for i in range(0, len(k) - 2, 3):
            if (k[i + 2] or 0) > 0:
                x, y = k[i], k[i + 1]
                if x <= 1 and y <= 1:
                    x, y = x * cw, y * CH
                k[i], k[i + 1] = x + dx, y
        q[key] = k
    return q


def detect(comfy, image: Path, log=print) -> list[dict]:
    """One OpenPose-format frame with every person any detector found (pixel coordinates)."""
    from PIL import Image
    with Image.open(image) as im:
        W, H = im.size
        strips = []
        if W > H * 1.1:                                   # wide picture: overlapping strips, about one figure each
            n = max(2, round(W / (H * 0.55)))
            sw = int(W / n * 1.5)
            for i in range(n):
                x0 = int(max(0, min(W - sw, (i + 0.5) * W / n - sw / 2)))
                crop = image.parent / f".strip_{image.stem}_{i}.png"
                im.crop((x0, 0, x0 + sw, H)).save(crop)
                strips.append((x0, sw, crop))
    name = comfy.upload(image, "manga", f"posedetect_{int(time.time())}{image.suffix or '.png'}")
    found = []
    for node, extra, res in DETECTORS:
        for fr in _run(comfy, name, node, extra, res):
            cw, ch = int(fr.get("canvas_width") or W), int(fr.get("canvas_height") or H)
            found += [_shift(p, 0, 1, W, cw, ch, H) for p in fr.get("people", [])]
    for x0, sw, crop in strips:
        cname = comfy.upload(crop, "manga", crop.name.lstrip("."))
        for fr in _run(comfy, cname, "DWPreprocessor", {"bbox_detector": "None", "pose_estimator": DW}, 768):
            cw, ch = int(fr.get("canvas_width") or sw), int(fr.get("canvas_height") or H)
            found += [_shift(p, x0, 1, W, cw, ch, H) for p in fr.get("people", [])]
        crop.unlink(missing_ok=True)
    # merge: one person per place, keeping the most complete reading. Two readings are the same person when
    # their necks are close or their outlines mostly overlap. Close-ups show few joints, so the bar drops
    # when nobody clears it.
    least = MIN_POINTS if any(_confident(p) >= MIN_POINTS for p in found) else 5
    found = sorted((p for p in found if _confident(p) >= least), key=_confident, reverse=True)
    people = []
    for p in found:
        ax, ay = _anchor(p, W, H)
        same = any(math.hypot(ax - bx, ay - by) < 0.08 * W or _overlap(p, q, W, H) > 0.45
                   for q in people for bx, by in [_anchor(q, W, H)])
        if not same:
            people.append(p)
    log(f"[pose] {len(people)} people (from {len(found)} readings)")
    return [{"people": people, "canvas_width": W, "canvas_height": H}]


def _fetch(comfy, prefix: str, hist: dict) -> list[dict]:
    # the JSON lands in ComfyUI's output folder; ask for it by name
    sub, base = prefix.rsplit("/", 1)
    for i in range(1, 6):
        for fn in (f"{base}_{i:05d}.json", f"{base}_{i:05d}_.json", f"{base}.json"):
            r = requests.get(f"{comfy.url}/view", params={"filename": fn, "subfolder": sub, "type": "output"}, timeout=60)
            if r.status_code == 200 and r.content.strip().startswith((b"[", b"{")):
                data = json.loads(r.content)
                return data if isinstance(data, list) else [data]
    raise RuntimeError("pose detection ran but its keypoint file was not found on the pod (" + json.dumps(hist.get("outputs", {}))[:300] + ")")


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
