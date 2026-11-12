"""Pose from an image: a pose detector on the pod finds every person's body and hand keypoints; this turns
each person into a library pose (metres, floor at 0, hips centred) plus where they stand in the picture,
so the Pose tab can add them as editable figures over the image.

Nothing is invented. A joint the detector did not see (low score, outside the picture, piled up on the
picture's edge, hanging off an unseen limb) is MISSING: it is not drawn, and its bones are not drawn.
In the pose it still has a position (the rest pose hung from the nearest seen joint, so it lands
somewhere sane if the user adds it back) and carries a fourth value 0: body[i] = [x, y, z, 0]. A hand
that was not seen has every point marked the same way. ui/static/pose.js and mp/poserender.py read that
mark; a pose without marks behaves exactly as before.

Detectors, best first, chosen from what the pod's ComfyUI actually has (/object_info):
  sdpose    SDPose-Wholebody + RT-DETR person boxes (ComfyUI core nodes): reads drawn and anime figures,
            body and hands, with a real score for every keypoint
  humanart  YOLOX + RTMPose trained on Human-Art (illustrations) through remote/setup_pod.sh's
            MangaHumanArtPose node: body only, real scores
  dwpose    DWPreprocessor (comfyui_controlnet_aux): photo-trained and its scores are all 1.0, so only
            the geometry tests can remove what it makes up; it also lends its hands to humanart bodies
  openpose  OpenposePreprocessor: last resort
Every picture is read twice: as it is, and placed on a larger plain canvas (cut-off figures get some
context around them). Keypoints are mapped back exactly; whatever lands in the padding is dropped."""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import requests

PARENT = {0: 1, 2: 1, 3: 2, 4: 3, 5: 1, 6: 5, 7: 6, 8: 1, 9: 8, 10: 9, 11: 1, 12: 11, 13: 12, 14: 0, 15: 0, 16: 14, 17: 15}
LIMBS = [(1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10), (1, 11), (11, 12), (12, 13), (1, 0), (0, 14), (14, 16), (0, 15), (15, 17)]
FIG_H = 1.75
# the library's standing figure (basic/Standing, metres): every length used for scale is measured on it,
# and unseen joints are hung from seen ones with its offsets
REST = [(0.0, 1.536), (0.0, 1.435), (-0.11, 1.398), (-0.175, 1.154), (-0.239, 0.916), (0.11, 1.398), (0.175, 1.154), (0.239, 0.916),
        (-0.083, 0.963), (-0.083, 0.503), (-0.083, 0.068), (0.083, 0.963), (0.083, 0.503), (0.083, 0.068),
        (-0.045, 1.582), (0.045, 1.582), (-0.085, 1.564), (0.085, 1.564)]
# a relaxed hand hanging from the wrist (wrist, then thumb, index, middle, ring, little: four points each)
REST_HAND = [(0.0, 0.0)] + [((f - 2) * 0.02 * (0.55 + 0.15 * j), -(0.03 + (0.016 if f == 0 else 0.023) * j)) for f in range(5) for j in range(1, 5)]

# ---- thresholds (scores are the detector's own, times how far that detector's scores can be trusted)
TRUST = {"sdpose": 1.0, "humanart": 1.0, "dwpose": 0.55, "openpose": 0.5}   # the last two write 1.0 for every point they keep
#          nose neck  Rsho  Relb  Rwri  Lsho  Lelb  Lwri  Rhip  Rkne  Rank  Lhip  Lkne  Lank  Reye  Leye  Rear  Lear
JOINT_T = [0.40, 0.40, 0.40, 0.45, 0.50, 0.40, 0.45, 0.50, 0.40, 0.45, 0.50, 0.40, 0.45, 0.50, 0.40, 0.40, 0.50, 0.50]
JOINT_T_MORE = {"humanart": {3: 0.50, 6: 0.50, 9: 0.50, 12: 0.50}}      # SimCC scores run higher on elbows and knees
HAND_T, HAND_MIN, HAND_ALONE = 0.40, 12, 0.60    # a hand point; points a hand needs; mean score of a hand with no wrist
CUT_M = 0.06                                     # a limb's last seen joint this close to an edge is the cut, not a joint
BORDER_T, BORDER_M = 0.65, 0.015                 # within BORDER_M x the short side of an edge a joint needs this score
FRAME_SLACK = 0.004                              # a joint this far (x short side) past the edge is rounding: pulled in
VETO = 0.20                                      # a better detector scoring a joint under this overrules a weaker one's claim
BONE_MIN, BONE_MAX = 0.08, 3.2                   # bone length as a multiple of the figure's reference width
OKS_K, OKS_SAME = 0.12, 0.5                      # two readings are one person when their shared joints agree this well
BOX_T = 0.35                                     # person-box score
# the padded copy: room around the picture as fractions of its size; the bottom grows towards 3:4 (w:h),
# the shape SDPose reads a whole picture in, because the unseen part of a bust or close-up is below it
PAD_SIDE, PAD_TOP, PAD_BOTTOM, PAD_BOTTOM_MAX = 0.10, 0.08, 0.30, 1.0
ANCHORS = (0, 1, 2, 5)                           # a person needs one of these, and three joints in all
SDPOSE_CKPT, RTDETR_UNET = "sdpose_wholebody_fp16.safetensors", "rt_detr_v4-x-hgnet_fp16.safetensors"
DW_BOX = ("yolox_l.torchscript.pt", "yolox_l.onnx")
DW_POSE = ("dw-ll_ucoco_384_bs5.torchscript.pt", "dw-ll_ucoco_384.onnx")


# ------------------------------------------------------------------------------ what the pod can run
def _spec(info: dict, node: str) -> dict:
    s = (info.get(node) or {}).get("input") or {}
    return {**(s.get("required") or {}), **(s.get("optional") or {})}


def _options(info: dict, node: str, field: str) -> list:
    v = _spec(info, node).get(field)
    if not v:
        return []
    if isinstance(v[0], list):
        return v[0]
    return list((v[1] or {}).get("options") or []) if len(v) > 1 and isinstance(v[1], dict) else []


def _pick(options: list, *wanted: str) -> str | None:
    """The first wanted file the node lists, by name or as the end of a subfolder path."""
    for w in wanted:
        for o in options:
            if isinstance(o, str) and (o == w or o.replace("\\", "/").endswith("/" + w)):
                return o
    return None


def _fit(info: dict, node: str, inputs: dict) -> dict:
    """Inputs the node really takes: unknown ones are left out, missing required ones get their default."""
    s = (info.get(node) or {}).get("input") or {}
    known = {**(s.get("required") or {}), **(s.get("optional") or {})}
    out = {k: v for k, v in inputs.items() if k in known}
    for k, v in (s.get("required") or {}).items():
        if k in out:
            continue
        if isinstance(v[0], list) and v[0]:
            out[k] = v[0][0]
        elif len(v) > 1 and isinstance(v[1], dict) and "default" in v[1]:
            out[k] = v[1]["default"]
    for k, v in list(out.items()):               # a choice the node does not offer: take the nearest it does
        opts = known[k][0] if isinstance(known[k][0], list) else None
        if opts and not isinstance(v, list) and v not in opts:
            out[k] = next((o for o in opts if str(v).lower() in str(o).lower()), opts[0])
    return out


def capabilities(comfy, log=print) -> dict:
    """Which detectors this ComfyUI can run, with the exact model names it lists."""
    try:
        info = comfy.object_info()
    except Exception as e:  # noqa: BLE001
        log(f"[pose] could not read the pod's node list ({e}); trying DWPose as it is")
        return {"info": {}, "save": "SavePoseKpsAsJsonFile", "dwpose": {"box": DW_BOX[0], "pose": DW_POSE[0]}}
    caps = {"info": info, "save": next((n for n in ("MangaSavePoseJSON", "SavePoseKpsAsJsonFile") if n in info), None)}
    if not caps["save"]:
        log("[pose] no node to export keypoints (comfyui_controlnet_aux or manga_pose_nodes): run `mangapipe pod setup`")
        return caps
    ckpt = _pick(_options(info, "CheckpointLoaderSimple", "ckpt_name"), SDPOSE_CKPT)
    if "SDPoseKeypointExtractor" in info and ckpt:
        unet = _pick(_options(info, "UNETLoader", "unet_name"), RTDETR_UNET)
        caps["sdpose"] = {"ckpt": ckpt, "unet": unet if "RTDETR_detect" in info else None}
        if not caps["sdpose"]["unet"]:
            log("[pose] SDPose without RT-DETR person boxes (node or model missing): each picture is read as one person")
    else:
        log("[pose] SDPose not on this pod (" + ("model missing" if "SDPoseKeypointExtractor" in info else "ComfyUI too old for SDPoseKeypointExtractor")
            + "); using the fallbacks. `mangapipe pod setup` installs it")
    if "MangaHumanArtPose" in info:
        caps["humanart"] = {}
    if "DWPreprocessor" in info:
        caps["dwpose"] = {"box": _pick(_options(info, "DWPreprocessor", "bbox_detector"), *DW_BOX) or DW_BOX[0],
                          "pose": _pick(_options(info, "DWPreprocessor", "pose_estimator"), *DW_POSE) or DW_POSE[0]}
    if "OpenposePreprocessor" in info:
        caps["openpose"] = {}
    return caps


# ------------------------------------------------------------------------------ graphs
def _g_sdpose(caps, name, prefix, boxes: bool) -> dict:
    info, c = caps["info"], caps["sdpose"]
    g = {"1": {"class_type": "LoadImage", "inputs": {"image": name}},
         "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": c["ckpt"]}}}
    kp = {"model": ["2", 0], "vae": ["2", 2], "image": ["1", 0], "batch_size": 16}
    if boxes and c["unet"]:
        g["3"] = {"class_type": "UNETLoader", "inputs": _fit(info, "UNETLoader", {"unet_name": c["unet"], "weight_dtype": "default"})}
        g["4"] = {"class_type": "RTDETR_detect", "inputs": _fit(info, "RTDETR_detect", {
            "model": ["3", 0], "image": ["1", 0], "threshold": BOX_T, "class_name": "person", "max_detections": 8})}
        kp["bboxes"] = ["4", 0]
    g["5"] = {"class_type": "SDPoseKeypointExtractor", "inputs": _fit(info, "SDPoseKeypointExtractor", kp)}
    g["6"] = {"class_type": caps["save"], "inputs": {"pose_kps": ["5", 0], "filename_prefix": prefix}}
    return g


def _g_humanart(caps, name, prefix) -> dict:
    return {"1": {"class_type": "LoadImage", "inputs": {"image": name}},
            "2": {"class_type": "MangaHumanArtPose", "inputs": _fit(caps["info"], "MangaHumanArtPose", {"image": ["1", 0], "box_threshold": BOX_T})},
            "3": {"class_type": caps["save"], "inputs": {"pose_kps": ["2", 0], "filename_prefix": prefix}}}


def _g_aux(caps, name, prefix, node: str, extra: dict, res: int) -> dict:
    ins = {"image": ["1", 0], "detect_hand": "enable", "detect_body": "enable", "detect_face": "disable", "resolution": res, **extra}
    return {"1": {"class_type": "LoadImage", "inputs": {"image": name}},
            "2": {"class_type": node, "inputs": _fit(caps["info"], node, ins) if caps["info"] else ins},
            "3": {"class_type": caps["save"], "inputs": {"pose_kps": ["2", 1], "filename_prefix": prefix}}}


def _fetch(comfy, prefix: str, hist: dict) -> list[dict]:
    # the save node returns the JSON with the run; older ones only write it to the output folder
    for out in (hist.get("outputs") or {}).values():
        for js in (out or {}).get("openpose_json") or []:
            try:
                data = json.loads(js) if isinstance(js, str) else js
                return data if isinstance(data, list) else [data]
            except ValueError:
                pass
    sub, base = prefix.rsplit("/", 1)
    for i in range(1, 6):
        for fn in (f"{base}_{i:05d}.json", f"{base}_{i:05d}_.json", f"{base}.json"):
            r = requests.get(f"{comfy.url}/view", params={"filename": fn, "subfolder": sub, "type": "output"}, timeout=60)
            if r.status_code == 200 and r.content.strip().startswith((b"[", b"{")):
                data = json.loads(r.content)
                return data if isinstance(data, list) else [data]
    raise RuntimeError("pose detection ran but its keypoint file was not found on the pod (" + json.dumps(hist.get("outputs", {}))[:300] + ")")


def _run(comfy, graph_for) -> list[dict]:
    prefix = f"MangaPipeline/posedetect_{int(time.time() * 1000)}"
    return _fetch(comfy, prefix, comfy.wait(comfy.queue(graph_for(prefix)), timeout=600))


# ------------------------------------------------------------------------------ views (what the detector is shown)
def pad_view(W: int, H: int) -> dict:
    """The picture at its own size on a larger canvas: a view {cw, ch, ox, oy, rect}. A canvas pixel
    (x, y) is picture pixel (x - ox, y - oy); rect is the part of the picture the view shows."""
    side, top = round(PAD_SIDE * W), round(PAD_TOP * H)
    cw, ch = W + 2 * side, H + top + round(PAD_BOTTOM * H)
    if cw * 4 > ch * 3:                                      # wider than 3:4: more room below, within reason
        ch = min(round(cw * 4 / 3), H + top + round(PAD_BOTTOM_MAX * H))
    if cw * 4 < ch * 3:                                      # taller: more room at the sides
        cw = round(ch * 3 / 4)
    return {"cw": cw, "ch": ch, "ox": (cw - W) // 2, "oy": top, "rect": (0, 0, W - 1, H - 1)}


def plain_view(W: int, H: int) -> dict:
    return {"cw": W, "ch": H, "ox": 0, "oy": 0, "rect": (0, 0, W - 1, H - 1)}


def tile_views(W: int, H: int) -> list[dict]:
    """Half-overlapping 3:4 upright tiles across a wide picture, each read as one person when no person
    box was found. The view's rect is the tile, so joints on a tile's cut edge are tested like any edge."""
    tw = min(W, max(1, round(H * 0.75)))
    n = max(1, math.ceil((W - tw) / (tw * 0.5))) + 1 if W > tw else 1
    xs = sorted({round(i * (W - tw) / max(1, n - 1)) for i in range(n)})
    return [{"cw": tw, "ch": H, "ox": -x0, "oy": 0, "rect": (x0, 0, x0 + tw - 1, H - 1), "crop": (x0, 0, x0 + tw, H)} for x0 in xs]


def _view_file(image: Path, view: dict, tag: str) -> Path:
    from PIL import Image
    dest = image.parent / f".{tag}_{image.stem}.png"
    with Image.open(image) as im:
        im = im.convert("RGB")
        if view.get("crop"):
            im.crop(view["crop"]).save(dest)
        else:
            bg = Image.new("RGB", (view["cw"], view["ch"]), (128, 128, 128))
            bg.paste(im, (view["ox"], view["oy"]))
            bg.save(dest)
    return dest


# ------------------------------------------------------------------------------ frames -> readings
def _is_normalised(frame: dict) -> bool:
    """Coordinates 0..1 instead of pixels: decided once for the whole frame, never point by point."""
    top = 0.0
    for p in frame.get("people") or []:
        for key in ("pose_keypoints_2d", "hand_left_keypoints_2d", "hand_right_keypoints_2d"):
            k = p.get(key) or []
            for i in range(0, len(k) - 2, 3):
                if (k[i + 2] or 0) > 0:
                    top = max(top, k[i] or 0, k[i + 1] or 0)
    return 0 < top <= 1.0


def _points(flat, n: int, sx: float, sy: float, view: dict, trust: float) -> list:
    """Flat [x, y, score, ...] on the detector's canvas -> n points (x, y, score) in picture pixels, or
    None where the detector gave nothing. Positions are not judged here."""
    out, flat = [], flat or []
    for i in range(n):
        p = None
        if 3 * i + 2 < len(flat):
            x, y, s = flat[3 * i: 3 * i + 3]
            if s and s > 0 and x is not None and y is not None and x >= 0 and y >= 0 and (x or y):
                p = (float(x) * sx - view["ox"], float(y) * sy - view["oy"], min(1.0, float(s)) * trust)
        out.append(p)
    return out


def readings(frames: list[dict], view: dict, src: str, W: int, H: int) -> list[dict]:
    """Every person in a detector's output as a reading: raw points mapped to picture pixels (pts, hpts),
    and the joints that pass the score, frame and edge tests (body, hands)."""
    out = []
    for fr in frames or []:
        if not isinstance(fr, dict):
            continue
        if _is_normalised(fr):
            sx, sy = float(view["cw"]), float(view["ch"])
        else:   # pixels of the detector's own, possibly resized, canvas
            sx, sy = view["cw"] / float(fr.get("canvas_width") or view["cw"]), view["ch"] / float(fr.get("canvas_height") or view["ch"])
        for p in fr.get("people") or []:
            pts = _points(p.get("pose_keypoints_2d"), 18, sx, sy, view, TRUST[src])
            hpts = [_points(p.get(key), 21, sx, sy, view, TRUST[src]) for key in ("hand_left_keypoints_2d", "hand_right_keypoints_2d")]
            r = {"src": src, "pts": pts, "hpts": hpts, "body": gate_body(pts, src, view["rect"], W, H)}
            r["hands"] = [gate_hand(hp, r["body"][w], view["rect"], W, H) for hp, w in zip(hpts, (7, 4))]
            if _is_person(r):
                out.append(r)
    return out


def _in_frame(p, rect, W, H):
    """The point pulled onto the edge when it is a rounding step outside, None when it is really outside."""
    slack = FRAME_SLACK * min(W, H)
    x0, y0, x1, y1 = rect
    x, y = p[0], p[1]
    if x < x0 - slack or y < y0 - slack or x > x1 + slack or y > y1 + slack:
        return None
    return (min(max(x, x0), x1), min(max(y, y0), y1), p[2])


def gate_body(pts, src, rect, W, H) -> list:
    more, m = JOINT_T_MORE.get(src, {}), BORDER_M * min(W, H)
    x0, y0, x1, y1 = rect
    out = []
    for i, p in enumerate(pts):
        q = None
        if p and p[2] >= more.get(i, JOINT_T[i]):
            q = _in_frame(p, rect, W, H)                  # outside the picture, or in the padding
            # top-down detectors always place every joint in the box; the unseen ones pile up on its edge
            if q and q[2] < BORDER_T and min(q[0] - x0, q[1] - y0, x1 - q[0], y1 - q[1]) < m:
                q = None
        out.append(q)
    # A figure cut by the frame: the last joint of a limb before the cut is drawn by detectors right on the
    # edge with a confident score (hips at the bottom of a bust shot). A joint that close to an edge whose
    # next joint down the limb was not seen is the cut itself, not a joint.
    cut = CUT_M * min(W, H)
    for chain in ((2, 3, 4), (5, 6, 7), (8, 9, 10), (11, 12, 13)):
        for k in (2, 1, 0):
            q = out[chain[k]]
            below = out[chain[k + 1]] if k < 2 else None
            if q and not below and min(q[0] - x0, q[1] - y0, x1 - q[0], y1 - q[1]) < cut and (k < 2 or q[2] < 0.8):
                if chain[0] in (8, 11) or k > 0:          # shoulders stay: they anchor the figure
                    out[chain[k]] = None
    return out


def gate_hand(hp, wrist, rect, W, H):
    """21 points (None where unseen) with their mean score, or None when the hand as a whole was not seen."""
    kept = [(_in_frame(p, rect, W, H) if p and p[2] >= HAND_T else None) for p in hp]
    good = [p for p in kept if p]
    if len(good) < HAND_MIN:
        return None
    mean = sum(p[2] for p in good) / len(good)
    return {"pts": kept, "score": mean} if wrist or mean >= HAND_ALONE else None


def _is_person(r: dict) -> bool:
    """Three joints, one of them head or shoulders; and not a reading that is mostly guesses: when few
    joints pass, they must be most of what the detector placed in the picture, or be strong."""
    kept = [p for p in r["body"] if p]
    if len(kept) < 3 or not any(r["body"][i] for i in ANCHORS):
        return False
    placed = sum(1 for p in r.get("pts", r["body"]) if p)
    return len(kept) >= 5 or len(kept) >= 0.35 * placed or sum(p[2] for p in kept) / len(kept) >= 0.6


# ------------------------------------------------------------------------------ merging readings
def _size(body) -> float:
    pts = [p for p in body if p]
    w, h = max(p[0] for p in pts) - min(p[0] for p in pts), max(p[1] for p in pts) - min(p[1] for p in pts)
    return max(math.sqrt(w * h), 0.5 * max(w, h), 1.0)


def similarity(a, b) -> float:
    """Object-keypoint similarity over the joints both readings kept (1 = identical, 0 = unrelated)."""
    shared = [i for i in range(18) if a[i] and b[i]]
    if len(shared) < 3:      # too little in common to compare shapes: the same only if what is shared coincides
        s = max(_size(a), _size(b))
        return 1.0 if shared and all(math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]) < 0.05 * s for i in shared) else 0.0
    s2 = max(_size(a), _size(b)) ** 2
    return sum(math.exp(-((a[i][0] - b[i][0]) ** 2 + (a[i][1] - b[i][1]) ** 2) / (2 * s2 * OKS_K ** 2)) for i in shared) / len(shared)


def _quality(r) -> tuple:
    kept = [p[2] for p in r["body"] if p]
    return (sum(kept) / len(kept), len(kept))


def fuse(group: list[dict], W: int, H: int) -> dict:
    """One person from several readings: each joint from the reading that scored it highest, unless a
    more trusted detector looked and scored that joint as absent."""
    body, by = [None] * 18, [None] * 18
    for i in range(18):
        for r in group:
            p = r["body"][i]
            if not p or (body[i] and body[i][2] >= p[2]):
                continue
            if any(TRUST[o["src"]] > TRUST[r["src"]] and o["pts"][i] and o["pts"][i][2] < VETO for o in group):
                continue
            body[i], by[i] = p, r
    hands = []
    for s, wj in ((0, 7), (1, 4)):
        best = None
        for r in group:
            hd = r["hands"][s]
            if not hd or (best and best["score"] >= hd["score"]):
                continue
            if body[wj]:      # the hand must belong to this wrist, whichever reading the wrist came from
                own = hd["pts"][0] or r["pts"][wj]
                elbow = body[wj - 1]
                reach = max(0.3 * math.hypot(body[wj][0] - elbow[0], body[wj][1] - elbow[1]) if elbow else 0, 0.04 * math.hypot(W, H))
                if not own or math.hypot(own[0] - body[wj][0], own[1] - body[wj][1]) > reach:
                    continue
            elif hd["score"] < HAND_ALONE:
                continue
            best = hd
        hands.append(best)
    return {"body": body, "hands": hands, "srcs": sorted({r["src"] for r in group})}


def _ref(body, W, H) -> float:
    """The figure's reference width in pixels: about its shoulder width, from whatever is seen."""
    d = lambda a, b: math.hypot(body[a][0] - body[b][0], body[a][1] - body[b][1]) if body[a] and body[b] else 0.0  # noqa: E731
    hip = [body[i] for i in (8, 11) if body[i]]
    torso = math.hypot(sum(p[0] for p in hip) / len(hip) - body[1][0], sum(p[1] for p in hip) / len(hip) - body[1][1]) if hip and body[1] else 0.0
    return max(d(2, 5), d(16, 17) * 1.3, d(14, 15) * 2.6, torso * 0.5) or 0.25 * _size(body)


def tidy(person: dict, W: int, H: int) -> dict:
    """Geometry tests on a fused person: a joint needs the joint it hangs from, bones have believable
    lengths, and two knees or ankles on one spot are one."""
    body, hands = list(person["body"]), list(person["hands"])
    ref = _ref(body, W, H)

    def chain():
        for i in (3, 4, 6, 7, 9, 10, 12, 13):                # outward from the trunk
            if body[i] and not body[PARENT[i]]:
                hand = hands[0 if i == 7 else 1] if i in (4, 7) else None
                if not (hand and body[i][2] >= HAND_ALONE):   # a hand reaching in from off-panel keeps its wrist
                    body[i] = None
    chain()
    for i in (3, 6, 9, 12, 4, 7, 10, 13):
        a, b = body[PARENT[i]], body[i]
        if a and b and not BONE_MIN * ref <= math.hypot(a[0] - b[0], a[1] - b[1]) <= BONE_MAX * ref:
            body[i] = None                                    # stacked on its parent, or flung across the picture
    for a, b in ((9, 12), (10, 13)):
        if body[a] and body[b] and math.hypot(body[a][0] - body[b][0], body[a][1] - body[b][1]) < 0.1 * ref:
            body[a if body[a][2] < body[b][2] else b] = None
    chain()
    for s, wj in ((0, 7), (1, 4)):
        if hands[s] and not body[wj] and hands[s]["score"] < HAND_ALONE:
            hands[s] = None
    return {**person, "body": body, "hands": hands}


def merge(found: list[dict], W: int, H: int) -> list[dict]:
    """Readings -> people. Greedy grouping, best-scored reading first, by keypoint similarity (so two
    characters who overlap stay two, and two readings of one character become one)."""
    groups: list[list[dict]] = []
    for r in sorted(found, key=_quality, reverse=True):
        for g in groups:
            if similarity(fuse(g, W, H)["body"], r["body"]) >= OKS_SAME:
                g.append(r)
                break
        else:
            groups.append([r])
    people = [tidy(fuse(g, W, H), W, H) for g in groups]
    people = [p for p in people if _is_person(p)]
    out = []                                                  # tidying can leave two groups showing the same joints
    for p in sorted(people, key=_quality, reverse=True):
        if all(similarity(p["body"], q["body"]) < OKS_SAME for q in out):
            out.append(p)
    return out


# ------------------------------------------------------------------------------ detection
def detect(comfy, image: Path, log=print) -> list[dict]:
    """Every person in the picture: {"body": 18 x (x, y, score) or None, "hands": [left, right] each
    {"pts", "score"} or None}, in picture pixels."""
    from PIL import Image
    with Image.open(image) as im:
        W, H = im.size
    caps = capabilities(comfy, log)
    if not caps.get("save") or not any(k in caps for k in ("sdpose", "humanart", "dwpose", "openpose")):
        raise RuntimeError("the pod has no pose detector installed: run `mangapipe pod setup`, then restart ComfyUI")
    stamp = int(time.time())
    names: dict[str, str] = {}

    def shown(tag: str, view: dict) -> str:                   # upload each view once
        if tag not in names:
            if tag == "plain":
                names[tag] = comfy.upload(image, "manga", f"posedetect_{stamp}{image.suffix or '.png'}")
            else:
                f = _view_file(image, view, tag)
                try:
                    names[tag] = comfy.upload(f, "manga", f"posedetect_{stamp}_{tag}.png")
                finally:
                    f.unlink(missing_ok=True)
        return names[tag]

    found, errors = [], []

    def read(src: str, tag: str, view: dict, graph) -> int:
        try:
            name = shown(tag, view)
            got = readings(_run(comfy, lambda prefix: graph(name, prefix)), view, src, W, H)
        except Exception as e:  # noqa: BLE001  one detector failing must not lose the others
            errors.append(f"{src}: {e}")
            log(f"[pose] {src} on the {tag} picture failed: {str(e)[:300]}")
            return 0
        log(f"[pose] {src} ({tag}): {len(got)} reading{'s' if len(got) != 1 else ''}")
        found.extend(got)
        return len(got)

    def dw_res(view: dict) -> int:                            # keep the picture itself at 1024 on its short side
        return int(min(1536, max(512, round(1024 * min(view["cw"], view["ch"]) / min(W, H) / 64) * 64)))

    views = [("plain", plain_view(W, H)), ("padded", pad_view(W, H))]
    # read without person boxes: a wide picture as overlapping upright tiles, any other as one person on the padded canvas
    whole = [(f"tile{i}", v) for i, v in enumerate(tile_views(W, H))] if W > H * 1.1 else [views[1]]
    dw = lambda box, res: lambda n, p: _g_aux(caps, n, p, "DWPreprocessor", {"bbox_detector": box, "pose_estimator": caps["dwpose"]["pose"]}, res)  # noqa: E731
    for tag, v in views:                                      # 1. the detectors that read drawn figures, with person boxes
        if "sdpose" in caps:
            read("sdpose", tag, v, lambda n, p: _g_sdpose(caps, n, p, True))
        if "humanart" in caps:
            read("humanart", tag, v, lambda n, p: _g_humanart(caps, n, p))
    people = merge(found, W, H)
    if not people and "sdpose" in caps:                       # 2. the person boxes failed (close-ups): SDPose without them
        for tag, v in whole:
            if caps["sdpose"]["unet"] or v.get("crop"):       # with no box model the padded picture was already read this way
                read("sdpose", tag, v, lambda n, p: _g_sdpose(caps, n, p, False))
        people = merge(found, W, H)
        log(f"[pose] no person box found; SDPose without boxes: {len(people)} people")
    # 3. DWPose: for its hands when the bodies came from the body-only detector, and for everything
    #    when nothing better is installed or the better ones found nobody
    if "dwpose" in caps and (not people or all(r["src"] == "humanart" for r in found)):
        for tag, v in views:
            read("dwpose", tag, v, dw(caps["dwpose"]["box"], dw_res(v)))
        people = merge(found, W, H)
        if not people:                                        # its person detector failed too: without boxes
            for tag, v in whole:
                read("dwpose", tag, v, dw("None", 1024 if v.get("crop") else dw_res(v)))
            people = merge(found, W, H)
    if not people and "openpose" in caps:                     # 4. last resort
        for tag, v in views:
            read("openpose", tag, v, lambda n, p: _g_aux(caps, n, p, "OpenposePreprocessor", {}, 768))
        people = merge(found, W, H)
    if not found and errors:
        raise RuntimeError("pose detection failed on the pod: " + "; ".join(errors)[:600])
    log(f"[pose] {len(people)} people from {len(found)} readings (" + ", ".join(sorted({r['src'] for r in found})) + ")")
    return people


# ------------------------------------------------------------------------------ person -> library pose
def _rest_len(a: int, b: int) -> float:
    return math.hypot(REST[a][0] - REST[b][0], REST[a][1] - REST[b][1])


def scale_of(body, H: int) -> tuple[float, str]:
    """Pixels per metre from the joints that were seen, each length measured against the same length on
    the library's standing figure. A drawn length is never longer than the real one (turning and leaning
    only shorten it), so where two measures exist the larger is used. In order:
      1. neck to hips (both hips, or the one seen), or the shoulder width if that says more
      2. shoulder width, but not less than 3/4 of what the head says (a figure turned sideways)
      3. ear to ear   4. eye to eye   5. the seen bones (median)   6. the two seen joints furthest apart
    A waist-up or a face therefore keeps its true size; legs that are not in the picture play no part."""
    d = lambda a, b: math.hypot(body[a][0] - body[b][0], body[a][1] - body[b][1])  # noqa: E731
    est = lambda a, b: d(a, b) / _rest_len(a, b) if body[a] and body[b] else 0.0  # noqa: E731
    head = est(16, 17) or est(14, 15)
    hips = [i for i in (8, 11) if body[i]]
    if hips and body[1]:
        hx, hy = sum(body[i][0] for i in hips) / len(hips), sum(body[i][1] for i in hips) / len(hips)
        rx, ry = sum(REST[i][0] for i in hips) / len(hips), sum(REST[i][1] for i in hips) / len(hips)
        torso = math.hypot(hx - body[1][0], hy - body[1][1]) / math.hypot(rx - REST[1][0], ry - REST[1][1])
        k, how = max((torso, "neck to hips"), (est(2, 5), "shoulder width"))
    elif est(2, 5):
        k, how = max((est(2, 5), "shoulder width"), (0.75 * head, "head width"))
    elif est(16, 17):
        k, how = est(16, 17), "ear to ear"
    elif est(14, 15):
        k, how = est(14, 15), "eye to eye"
    else:
        bones = sorted(e for e in (est(a, b) for a, b in LIMBS) if e)
        seen = [i for i in range(18) if body[i]]
        if bones:
            k, how = bones[len(bones) // 2], "seen bones"
        else:
            k, how = max([est(a, b) for a in seen for b in seen if a < b] or [0.0]), "seen joints"
    if k < 1.0:
        k, how = 0.85 * H / FIG_H, "default"
    return k, how


def framing(body) -> str:
    """How much of the figure the picture shows (nothing is drawn from this)."""
    if not (body[8] or body[11]):
        return "bust" if any(body[i] for i in (1, 2, 5)) else "face"
    if not (body[9] or body[12]):
        return "waist up"
    return "full" if (body[10] or body[13]) else "knees up"


def person_to_pose(person: dict, W: int, H: int) -> dict | None:
    """A detected person (picture pixels) -> library pose + place. Seen joints project back onto exactly
    the pixels they were found at; unseen ones are marked [x, y, 0, 0] and hang in the rest pose from the
    nearest seen joint, at the figure's scale. The floor can lie below the picture (place.y > 1)."""
    body = person["body"]
    if sum(p is not None for p in body) < 3:
        return None
    k, how = scale_of(body, H)
    # the rest pose faces us; a figure seen from behind has its left side on our left
    turned = any(body[a] and body[b] and body[b][0] < body[a][0] for a, b in ((2, 5), (8, 11)))
    off = lambda i, j: ((REST[i][0] - REST[j][0]) * (-1 if turned else 1) * k, -(REST[i][1] - REST[j][1]) * k)  # noqa: E731  pixels, y down
    px = [(p[0], p[1]) if p else None for p in body]
    kids = {j: [i for i, par in PARENT.items() if par == j] for j in range(18)}
    for _ in range(18):
        if all(px):
            break
        for i in range(18):
            if px[i]:
                continue
            par = PARENT.get(i)
            if par is not None and px[par]:
                o = off(i, par)
                px[i] = (px[par][0] + o[0], px[par][1] + o[1])
            else:
                near = [(px[c][0] - off(c, i)[0], px[c][1] - off(c, i)[1]) for c in kids[i] if px[c]]
                if near:
                    px[i] = (sum(q[0] for q in near) / len(near), sum(q[1] for q in near) / len(near))
    hands_px, hand_seen = [], []
    for s, wj in ((0, 7), (1, 4)):
        hd = person["hands"][s]
        side = (1 if s == 0 else -1) * (-1 if turned else 1)
        rest = [(px[wj][0] + side * x * k, px[wj][1] - y * k) for x, y in REST_HAND]
        if not hd:
            hands_px.append(rest)
            hand_seen.append([False] * 21)
            continue
        pts, got = [], []
        for i, p in enumerate(hd["pts"]):
            if p:
                pts.append((p[0], p[1]))
            else:   # an unseen point of a seen hand waits on the point before it along the finger
                pts.append(pts[0 if i % 4 == 1 else i - 1] if i else rest[0])
            got.append(bool(p))
        hands_px.append(pts)
        hand_seen.append(got)
    hx = (px[8][0] + px[11][0]) / 2
    floor = max(p[1] for p in px + hands_px[0] + hands_px[1])
    to3 = lambda p, seen: [round((p[0] - hx) / k, 4), round((floor - p[1]) / k, 4), 0.0] + ([] if seen else [0])  # noqa: E731
    miss = [i for i in range(18) if not body[i]]
    return {"body": [to3(p, bool(body[i])) for i, p in enumerate(px)],
            "hands": [[to3(p, g) for p, g in zip(hd, got)] for hd, got in zip(hands_px, hand_seen)],
            "miss": miss, "confidence": [round(p[2], 3) if p else 0.0 for p in body],
            "framing": framing(body), "scale_from": how,
            "place": {"x": round(hx / W, 4), "y": round(floor / H, 4), "scale": round(k * FIG_H / H, 4)}}


def poses_from_image(comfy, image: Path, log=print) -> dict:
    from PIL import Image
    with Image.open(image) as im:
        W, H = im.size
    people = [p for p in (person_to_pose(q, W, H) for q in detect(comfy, image, log)) if p]
    people.sort(key=lambda p: p["place"]["x"])           # left to right, like the character list
    for p in people:
        log(f"[pose] figure at x={p['place']['x']}: {p['framing']}, {18 - len(p['miss'])}/18 joints, scale from {p['scale_from']}")
    return {"w": W, "h": H, "people": people}
