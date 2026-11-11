"""Koikatsu Sunshine studio poses -> OpenPose keypoints, with our own forward kinematics.

A studio pose file (`UserData/studio/pose/**/*.dat`) stores, per FK bone, the local rotation the
studio applies to that bone. This module rebuilds the body from a rest skeleton (bone offsets
measured from the game's base body), applies those rotations, and reads off the joints OpenPose
uses: 18 body points (COCO order), 21 points per hand and 3 per foot. Nothing from the game is
copied: the output is a set of 3D points per pose, written to `poses/library.json`.

Coordinates of the output: metres, y up, the character faces +z (toward a front camera) and its
left side is +x, so a front view draws screen_x = x, screen_y = -y.

    ./mangapipe poses build [--src <KKS>/UserData/studio/pose] [--out poses/library.json]
"""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

import numpy as np

# name: (parent, local position, local rotation quaternion xyzw) in Unity's left-handed frame
REST = {
    "cf_n_height": (None, (-0.0, 0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_hips": ("cf_n_height", (-0.0, 1.1435, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_spine01": ("cf_j_hips", (-0.0, 0.005, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_spine02": ("cf_j_spine01", (-0.0, 0.09, -0.0066), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_spine03": ("cf_j_spine02", (-0.0, 0.09, -0.0102), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_neck": ("cf_j_spine03", (-0.0, 0.1219, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_head": ("cf_j_neck", (-0.0, 0.065, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_waist01": ("cf_j_hips", (-0.0, -0.005, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_waist02": ("cf_j_waist01", (-0.0, -0.1353, -0.0166), (0.0, -0.0, -0.0, 1.0)),
    "cf_d_shoulder_L": ("cf_j_spine03", (-0.0156, 0.0847, -0.007), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_shoulder_L": ("cf_d_shoulder_L", (-0.0, 0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_arm00_L": ("cf_j_shoulder_L", (-0.094, 0.0, 0.0), (-0.0, -0.022, -0.0, 0.9998)),
    "cf_j_forearm01_L": ("cf_j_arm00_L", (-0.253, 0.0, -0.0), (-0.0, 0.022, 0.0, 0.9998)),
    "cf_j_hand_L": ("cf_j_forearm01_L", (-0.25, -0.0, 0.0), (0.0, 0.0, -0.0, 1.0)),
    "cf_s_hand_L": ("cf_j_hand_L", (-0.0, 0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_thumb01_L": ("cf_s_hand_L", (-0.0023, -0.0095, 0.0237), (0.6533, 0.2706, -0.153, 0.6903)),
    "cf_j_thumb02_L": ("cf_j_thumb01_L", (-0.034, 0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_thumb03_L": ("cf_j_thumb02_L", (-0.025, 0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_index01_L": ("cf_s_hand_L", (-0.056, 0.0011, 0.0209), (0.0329, 0.0451, 0.042, 0.9976)),
    "cf_j_index02_L": ("cf_j_index01_L", (-0.0311, 0.0, -0.0), (-0.0, 0.0, 0.0001, 1.0)),
    "cf_j_index03_L": ("cf_j_index02_L", (-0.0207, 0.0, -0.0), (-0.0, 0.0, 0.0, 1.0)),
    "cf_j_middle01_L": ("cf_s_hand_L", (-0.0585, 0.0037, 0.0054), (-0.0262, -0.0011, 0.0436, 0.9987)),
    "cf_j_middle02_L": ("cf_j_middle01_L", (-0.0342, 0.0, 0.0), (-0.0, -0.0, -0.0001, 1.0)),
    "cf_j_middle03_L": ("cf_j_middle02_L", (-0.0228, 0.0, -0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_ring01_L": ("cf_s_hand_L", (-0.0539, 0.0008, -0.0093), (-0.0681, -0.0378, 0.0411, 0.9961)),
    "cf_j_ring02_L": ("cf_j_ring01_L", (-0.0326, 0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_ring03_L": ("cf_j_ring02_L", (-0.0217, -0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_little01_L": ("cf_s_hand_L", (-0.0467, -0.0055, -0.0224), (-0.1357, -0.0751, 0.0334, 0.9873)),
    "cf_j_little02_L": ("cf_j_little01_L", (-0.0285, 0.0, 0.0), (0.0, -0.0, 0.0, 1.0)),
    "cf_j_little03_L": ("cf_j_little02_L", (-0.0155, -0.0, -0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_thigh00_L": ("cf_j_waist02", (-0.083, -0.025, 0.0), (0.0087, 0.0, 0.0, 1.0)),
    "cf_j_leg01_L": ("cf_j_thigh00_L", (-0.0, -0.46, 0.0), (0.0087, 0.0, -0.0, 1.0)),
    "cf_j_leg03_L": ("cf_j_leg01_L", (-0.0, -0.435, 0.0), (0.0, -0.0, 0.0, 1.0)),
    "cf_j_foot_L": ("cf_j_leg03_L", (-0.0, -0.05, -0.01), (-0.0175, 0.0, -0.0, 0.9998)),
    "cf_j_toes_L": ("cf_j_foot_L", (-0.0, -0.0074, 0.1071), (0.0, -0.0, -0.0, 1.0)),
    "cf_d_shoulder_R": ("cf_j_spine03", (0.0156, 0.0847, -0.007), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_shoulder_R": ("cf_d_shoulder_R", (-0.0, 0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_arm00_R": ("cf_j_shoulder_R", (0.094, 0.0, 0.0), (-0.0, 0.0212, -0.0, 0.9998)),
    "cf_j_forearm01_R": ("cf_j_arm00_R", (0.2531, 0.0, -0.0), (0.0, -0.0212, -0.0, 0.9998)),
    "cf_j_hand_R": ("cf_j_forearm01_R", (0.25, 0.0, 0.0), (-0.0, 0.0, 0.0, 1.0)),
    "cf_s_hand_R": ("cf_j_hand_R", (-0.0, 0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_thumb01_R": ("cf_s_hand_R", (0.0023, -0.0095, 0.0237), (-0.6903, -0.153, -0.2706, 0.6533)),
    "cf_j_thumb02_R": ("cf_j_thumb01_R", (0.034, 0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_thumb03_R": ("cf_j_thumb02_R", (0.025, 0.0, 0.0), (0.0, -0.0, -0.0, 1.0)),
    "cf_j_index01_R": ("cf_s_hand_R", (0.056, 0.0011, 0.0209), (0.9976, -0.042, 0.0451, -0.0329)),
    "cf_j_index02_R": ("cf_j_index01_R", (0.0311, -0.0, -0.0), (0.0, -0.0, 0.0004, 1.0)),
    "cf_j_index03_R": ("cf_j_index02_R", (0.0207, -0.0, -0.0), (-0.0, -0.0, -0.0001, 1.0)),
    "cf_j_middle01_R": ("cf_s_hand_R", (0.0585, 0.0037, 0.0054), (0.9987, -0.0436, -0.0011, 0.0262)),
    "cf_j_middle02_R": ("cf_j_middle01_R", (0.0342, 0.0, 0.0), (0.0, 0.0, -0.0002, 1.0)),
    "cf_j_middle03_R": ("cf_j_middle02_R", (0.0228, -0.0, -0.0), (0.0, -0.0, 0.0003, 1.0)),
    "cf_j_ring01_R": ("cf_s_hand_R", (0.0539, 0.0008, -0.0093), (0.9961, -0.0411, -0.0378, 0.0681)),
    "cf_j_ring02_R": ("cf_j_ring01_R", (0.0326, 0.0, 0.0), (0.0, 0.0, -0.0002, 1.0)),
    "cf_j_ring03_R": ("cf_j_ring02_R", (0.0217, 0.0, 0.0), (0.0, -0.0, 0.0001, 1.0)),
    "cf_j_little01_R": ("cf_s_hand_R", (0.0467, -0.0055, -0.0224), (0.9873, -0.0334, -0.0751, 0.1357)),
    "cf_j_little02_R": ("cf_j_little01_R", (0.0285, 0.0, 0.0), (-0.0, -0.0, -0.0001, 1.0)),
    "cf_j_little03_R": ("cf_j_little02_R", (0.0155, 0.0, -0.0), (0.0, 0.0, -0.0001, 1.0)),
    "cf_j_thigh00_R": ("cf_j_waist02", (0.083, -0.025, 0.0), (0.0087, 0.0, 0.0, 1.0)),
    "cf_j_leg01_R": ("cf_j_thigh00_R", (-0.0, -0.46, 0.0), (0.0087, -0.0, -0.0, 1.0)),
    "cf_j_leg03_R": ("cf_j_leg01_R", (-0.0, -0.435, 0.0), (-0.0, -0.0, 0.0, 1.0)),
    "cf_j_foot_R": ("cf_j_leg03_R", (-0.0, -0.05, -0.01), (-0.0175, -0.0, -0.0, 0.9998)),
    "cf_j_toes_R": ("cf_j_foot_R", (-0.0, -0.0074, 0.1071), (-0.0, -0.0, -0.0, 1.0)),
}

# FK slot (the studio's bone number) -> bone name. Hair, bust, skirt and accessory slots are ignored.
FK_SLOTS = {
    0: "cf_j_hips", 1: "cf_j_head", 2: "cf_j_neck", 3: "cf_j_spine02", 4: "cf_j_spine01", 5: "cf_j_waist01",
    6: "cf_j_thigh00_R", 7: "cf_j_leg01_R", 8: "cf_j_leg03_R", 9: "cf_j_toes_R",
    10: "cf_j_thigh00_L", 11: "cf_j_leg01_L", 12: "cf_j_leg03_L", 13: "cf_j_toes_L",
    14: "cf_j_shoulder_R", 15: "cf_j_arm00_R", 16: "cf_j_forearm01_R", 17: "cf_j_hand_R",
    18: "cf_j_shoulder_L", 19: "cf_j_arm00_L", 20: "cf_j_forearm01_L", 21: "cf_j_hand_L",
}
_FINGERS = ("thumb", "index", "middle", "ring", "little")
for _i, (_side, _base) in enumerate((("R", 22), ("L", 37))):
    for _f, _name in enumerate(_FINGERS):
        for _j in range(3):
            FK_SLOTS[_base + _f * 3 + _j] = f"cf_j_{_name}0{_j + 1}_{_side}"

# Points on the head, in the head bone's frame (from the face rig: nose tip, eye centres, ear roots).
HEAD_POINTS = {"nose": (0.0, 0.036, 0.098), "eye_L": (-0.045, 0.082, 0.065), "eye_R": (0.045, 0.082, 0.065),
               "ear_L": (-0.085, 0.064, 0.008), "ear_R": (0.085, 0.064, 0.008)}

# OpenPose COCO-18 body order
BODY = ["nose", "neck", "shoulder_R", "elbow_R", "wrist_R", "shoulder_L", "elbow_L", "wrist_L",
        "hip_R", "knee_R", "ankle_R", "hip_L", "knee_L", "ankle_L", "eye_R", "eye_L", "ear_R", "ear_L"]
BODY_BONES = {"neck": "cf_j_neck", "shoulder_R": "cf_j_arm00_R", "elbow_R": "cf_j_forearm01_R", "wrist_R": "cf_j_hand_R",
              "shoulder_L": "cf_j_arm00_L", "elbow_L": "cf_j_forearm01_L", "wrist_L": "cf_j_hand_L",
              "hip_R": "cf_j_thigh00_R", "knee_R": "cf_j_leg01_R", "ankle_R": "cf_j_leg03_R",
              "hip_L": "cf_j_thigh00_L", "knee_L": "cf_j_leg01_L", "ankle_L": "cf_j_leg03_L"}


# ------------------------------------------------------------------------------ maths
def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    tx, ty, tz = 2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)
    return (vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx)


def euler(x, y, z):
    """Unity's Quaternion.Euler: z, then x, then y (degrees)."""
    def axis(i, deg):
        h = math.radians(deg) / 2
        q = [0.0, 0.0, 0.0, math.cos(h)]
        q[i] = math.sin(h)
        return tuple(q)
    return qmul(qmul(axis(1, y), axis(0, x)), axis(2, z))


# ------------------------------------------------------------------------------ file format
def _varstr(b: bytes, o: int) -> tuple[str, int]:
    n = shift = 0
    while True:
        c = b[o]
        o += 1
        n |= (c & 0x7F) << shift
        shift += 7
        if not c & 0x80:
            break
    return b[o:o + n].decode("utf-8", "replace"), o + n


def parse_pose(data: bytes) -> dict:
    """Read a studio pose file: name, sex and the FK rotations (degrees) per slot."""
    tag, o = _varstr(data, 0)
    if "pose" not in tag:
        raise ValueError("not a studio pose file")
    _ver, sex = struct.unpack_from("<ii", data, o)
    o += 8
    name, o = _varstr(data, o)
    o += 12 + 4  # base animation (group, category, number) and its time
    o += 1 + 5   # IK enabled, IK parts
    (n,) = struct.unpack_from("<i", data, o)
    o += 4 + n * 40
    o += 1 + 7   # FK enabled, FK parts
    (n,) = struct.unpack_from("<i", data, o)
    o += 4
    fk = {}
    for _ in range(n):
        (k,) = struct.unpack_from("<i", data, o)
        v = struct.unpack_from("<9f", data, o + 4)
        o += 40
        fk[k] = v[3:6]
    return {"name": name.strip(), "sex": sex, "fk": fk}


# ------------------------------------------------------------------------------ skeleton
def solve(fk: dict[int, tuple]) -> dict[str, tuple]:
    """World position and rotation of every bone in REST after applying the FK rotations."""
    local = {FK_SLOTS[k]: euler(*v) for k, v in fk.items() if k in FK_SLOTS}
    world: dict[str, tuple] = {}

    def get(n):
        if n in world:
            return world[n]
        par, pos, rot = REST[n]
        r = local.get(n, rot)
        if par is None:
            world[n] = (pos, r)
        else:
            pp, pr = get(par)
            d = qrot(pr, pos)
            world[n] = ((pp[0] + d[0], pp[1] + d[1], pp[2] + d[2]), qmul(pr, r))
        return world[n]

    for n in REST:
        get(n)
    return world


def _at(world, bone, offset):
    p, r = world[bone]
    d = qrot(r, offset)
    return (p[0] + d[0], p[1] + d[1], p[2] + d[2])


def keypoints(fk: dict[int, tuple]) -> dict:
    """OpenPose points (body 18, hands 21 each as [left, right], feet 3 each) for one pose."""
    w = solve(fk)
    pt = {k: w[b][0] for k, b in BODY_BONES.items()}
    pt.update({k: _at(w, "cf_j_head", v) for k, v in HEAD_POINTS.items()})
    body = [pt[k] for k in BODY]
    hands = []
    for side in "LR":
        h = [w[f"cf_j_hand_{side}"][0]]
        for f in _FINGERS:
            for j in (1, 2, 3):
                h.append(w[f"cf_j_{f}0{j}_{side}"][0])
            h.append(_at(w, f"cf_j_{f}03_{side}", tuple(0.8 * c for c in REST[f"cf_j_{f}03_{side}"][1])))
        hands.append(h)
    feet = []
    for side in "LR":
        toe = w[f"cf_j_toes_{side}"][0]
        feet.append([_at(w, f"cf_j_toes_{side}", (0.0, 0.0, 0.035)),        # big toe (tip)
                     _at(w, f"cf_j_toes_{side}", (0.035 * (-1 if side == "L" else 1), 0.0, 0.0)),  # small toe
                     _at(w, f"cf_j_leg03_{side}", (0.0, -0.07, -0.045))])  # heel
        del toe
    allp = np.array(body + hands[0] + hands[1] + feet[0] + feet[1], dtype=float)
    # to the output frame: character's left = +x, floor at y = 0, hips centred
    allp[:, 0] *= -1
    allp[:, 1] -= allp[:, 1].min()
    hip = (allp[8] + allp[11]) / 2
    allp[:, 0] -= hip[0]
    allp[:, 2] -= hip[2]
    allp = np.round(allp, 4)
    return {"body": allp[:18].tolist(), "hands": [allp[18:39].tolist(), allp[39:60].tolist()],
            "feet": [allp[60:63].tolist(), allp[63:66].tolist()]}


# ------------------------------------------------------------------------------ library
def build_library(src: Path, out: Path) -> dict:
    """Convert every pose file under `src` into one JSON library (packs -> poses)."""
    poses, failed = [], []
    for f in sorted(src.rglob("*.dat"), key=lambda p: str(p).lower()):
        rel = f.relative_to(src)
        try:
            p = parse_pose(f.read_bytes())
            kp = keypoints(p["fk"])
        except Exception as e:  # noqa: BLE001
            failed.append(f"{rel}: {e}")
            continue
        parts = rel.parent.parts
        poses.append({"id": rel.with_suffix("").as_posix(), "name": p["name"] or f.stem,
                      "pack": (parts[0] if parts else "Poses").strip(" ~"),
                      "group": "/".join(parts[1:]), **kp})
    lib = {"version": 1, "source": "Koikatsu studio poses", "count": len(poses), "poses": poses}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(lib, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return {"count": len(poses), "failed": failed, "path": str(out)}
