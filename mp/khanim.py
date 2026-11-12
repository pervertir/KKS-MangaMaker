"""Koikatsu Sunshine H-scene animations -> two- and three-person OpenPose group poses.

The H scenes are not studio pose files but Unity AnimationClips (abdata/h/anim/{female,male}/*.unity3d),
one AnimatorController per position. For every position this module takes one frame of its main loop
for each actor, reads the bone rotations and positions straight out of the clip's curve data (our own
decoder for Unity's streamed / dense / constant clip formats), runs them through the same rest skeleton
and forward kinematics as mp.kkpose, and writes the actors together as a group pose: every figure keeps
its place relative to the others, so the library can drop the whole position into a scene.

Needs UnityPy (MIT; `pip install UnityPy`) only to open the bundles:

    ./mangapipe poses build-h [--src <KKS>/abdata/h/anim] [--out poses/h_library.json]
"""
from __future__ import annotations

import json
import math
import re
import struct
import zlib
from pathlib import Path

import numpy as np

from .kkpose import BODY, BODY_BONES, HEAD_POINTS, REST, _FINGERS, pose_kind, qmul, qrot

# file prefix -> (kind label, what the actors are)
CATEGORIES = {
    "kha": "Adult · Foreplay", "khh": "Adult · Oral & service", "khs": "Adult · Sex", "kht": "Adult · Solo",
    "khn": "Adult · Solo", "khr": "Adult · Girl & girl", "khh3": "Adult · Threesome", "khs3": "Adult · Threesome",
}
MALE_SCALE = 1.08          # the male body is a little taller; the female rest skeleton scaled up stands in for it
LOOP_PREFS = (r"^M_WLoop1?$", r"^M_WLoop", r"^WLoop", r"WLoop", r"Loop", r"Idle")


def _chain(n: str) -> list[str]:
    out = []
    while n:
        out.append(n)
        n = REST[n][0]
    return list(reversed(out))


# animation curves address transforms by the CRC32 of their path below the animator ("cf_j_root/cf_n_height/...")
PATH_HASH = {zlib.crc32(("cf_j_root/" + "/".join(_chain(n))).encode()): n for n in REST}


# ------------------------------------------------------------------------------ clip decoding
def _streamed(words, curve_count: int, t: float) -> dict[int, float]:
    """Unity streamed clip: frames of (time, keys[index, 4 cubic coefficients]). Value of each curve at t."""
    raw = struct.pack(f"<{len(words)}I", *[w & 0xFFFFFFFF for w in words])
    o, best = 0, {}
    while o + 8 <= len(raw):
        ftime, n = struct.unpack_from("<fI", raw, o)
        o += 8
        if ftime > t + 1e-6:
            break
        for _ in range(n):
            idx, c0, c1, c2, c3 = struct.unpack_from("<i4f", raw, o)
            o += 20
            best[idx] = (ftime, c0, c1, c2, c3)
    out = {}
    for idx, (ft, c0, c1, c2, c3) in best.items():
        dt = 0.0 if not math.isfinite(ft) else t - ft
        out[idx] = ((c0 * dt + c1) * dt + c2) * dt + c3
    return out


def clip_values(clip, t: float = 0.0) -> list[float]:
    """Every curve's value at time t, in binding order (streamed, then dense, then constant)."""
    mc = clip.m_MuscleClip.m_Clip
    mc = getattr(mc, "data", mc)
    s, d, c = mc.m_StreamedClip, mc.m_DenseClip, mc.m_ConstantClip
    vals = [0.0] * (s.curveCount + d.m_CurveCount + len(c.data))
    for i, v in _streamed(s.data, s.curveCount, t).items():
        if 0 <= i < s.curveCount:
            vals[i] = v
    if d.m_CurveCount and d.m_FrameCount:
        f = min(d.m_FrameCount - 1, max(0, int(round((t - d.m_BeginTime) * d.m_SampleRate))))
        base = f * d.m_CurveCount
        for i in range(d.m_CurveCount):
            vals[s.curveCount + i] = float(d.m_SampleArray[base + i])
    off = s.curveCount + d.m_CurveCount
    for i, v in enumerate(c.data):
        vals[off + i] = float(v)
    return vals


def bone_tracks(clip, t: float = 0.0) -> tuple[dict, dict]:
    """{bone: local rotation quaternion}, {bone: local position} for the skeleton bones the clip animates."""
    vals = clip_values(clip, t)
    rots, poss, i = {}, {}, 0
    for b in clip.m_ClipBindingConstant.genericBindings:
        width = {1: 3, 2: 4, 3: 3, 4: 3}.get(b.attribute, 1)
        name = PATH_HASH.get(b.path) if b.typeID == 4 else None
        if name:
            if b.attribute == 2:
                q = vals[i:i + 4]
                nrm = math.sqrt(sum(x * x for x in q)) or 1.0
                rots[name] = tuple(x / nrm for x in q)
            elif b.attribute == 1:
                poss[name] = tuple(vals[i:i + 3])
        i += width
    return rots, poss


# ------------------------------------------------------------------------------ skeleton
def world_points(rots: dict, poss: dict, scale: float = 1.0) -> np.ndarray:
    """Body 18 + hands 2x21 in Unity world metres (same order as mp.kkpose.keypoints, before its re-framing)."""
    world: dict[str, tuple] = {}

    def get(n):
        if n in world:
            return world[n]
        par, pos, rot = REST[n]
        p = poss.get(n, pos)
        r = rots.get(n, rot)
        if par is None:
            # cf_n_height sits under cf_j_root, which carries the actor's place in the scene
            root_p, root_r = poss.get("__root_p", (0.0, 0.0, 0.0)), rots.get("__root_r", (0.0, 0.0, 0.0, 1.0))
            d = qrot(root_r, p)
            world[n] = ((root_p[0] + d[0], root_p[1] + d[1], root_p[2] + d[2]), qmul(root_r, r))
        else:
            pp, pr = get(par)
            d = qrot(pr, p)
            world[n] = ((pp[0] + d[0], pp[1] + d[1], pp[2] + d[2]), qmul(pr, r))
        return world[n]

    for n in REST:
        get(n)

    def at(bone, off):
        p, r = world[bone]
        d = qrot(r, off)
        return (p[0] + d[0], p[1] + d[1], p[2] + d[2])

    pt = {k: world[b][0] for k, b in BODY_BONES.items()}
    pt.update({k: at("cf_j_head", v) for k, v in HEAD_POINTS.items()})
    pts = [pt[k] for k in BODY]
    for side in "LR":
        pts.append(world[f"cf_j_hand_{side}"][0])
        for f in _FINGERS:
            for j in (1, 2, 3):
                pts.append(world[f"cf_j_{f}0{j}_{side}"][0])
            pts.append(at(f"cf_j_{f}03_{side}", tuple(0.8 * c for c in REST[f"cf_j_{f}03_{side}"][1])))
    a = np.array(pts, dtype=float) * scale
    return a


def actor_points(clip, male: bool, t: float = 0.0) -> np.ndarray:
    rots, poss = bone_tracks(clip, t)
    # the clip's own cf_j_root place (both actors share the scene origin, so this keeps them together)
    root = next((b for b in clip.m_ClipBindingConstant.genericBindings if b.path == zlib.crc32(b"cf_j_root")), None)
    if root is not None:
        r2, p2 = _root_tracks(clip, t)
        poss["__root_p"], rots["__root_r"] = p2, r2
    return world_points(rots, poss, MALE_SCALE if male else 1.0)


def _root_tracks(clip, t):
    vals = clip_values(clip, t)
    i, p, r = 0, (0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0)
    h = zlib.crc32(b"cf_j_root")
    for b in clip.m_ClipBindingConstant.genericBindings:
        width = {1: 3, 2: 4, 3: 3, 4: 3}.get(b.attribute, 1)
        if b.path == h and b.typeID == 4:
            if b.attribute == 1:
                p = tuple(vals[i:i + 3])
            elif b.attribute == 2:
                q = vals[i:i + 4]
                n = math.sqrt(sum(x * x for x in q)) or 1.0
                r = tuple(x / n for x in q)
        i += width
    return r, p


# ------------------------------------------------------------------------------ group poses
def group_entry(pid: str, name: str, kind: str, actors: list[tuple[np.ndarray, str]], aspect: float = 1.0) -> dict:
    """Actors (Unity world points, gender) -> a group pose: per member figure-frame points + canvas place."""
    flip = np.array([-1.0, 1.0, 1.0])               # to the library frame: character's left = +x
    pts = [a * flip for a, _ in actors]
    # turn the whole group to the side view that separates the bodies best (most spread across the
    # picture), preferring views close to the front: overlapping figures read badly as stick figures
    allw = np.concatenate(pts)
    cx, cz = allw[:, 0].mean(), allw[:, 2].mean()
    best = (-1.0, 0.0)
    for deg in range(-90, 91, 15):
        a = math.radians(deg)
        xs = (allw[:, 0] - cx) * math.cos(a) + (allw[:, 2] - cz) * math.sin(a)
        score = (xs.max() - xs.min()) * (1 - abs(deg) / 900)
        if score > best[0]:
            best = (score, a)
    ca, sa = math.cos(best[1]), math.sin(best[1])
    turned = []
    for p in pts:
        q = p.copy()
        q[:, 0] = (p[:, 0] - cx) * ca + (p[:, 2] - cz) * sa
        q[:, 2] = -(p[:, 0] - cx) * sa + (p[:, 2] - cz) * ca
        turned.append(q)
    pts = turned
    allp = np.concatenate(pts)
    floor = allp[:, 1].min()
    x0, x1, top = allp[:, 0].min(), allp[:, 0].max(), allp[:, 1].max() - floor
    fig_h = 1.75
    s = min(0.8 * fig_h / max(top, 0.3), 0.9 * aspect * fig_h / max(x1 - x0, 0.3))
    k = s / fig_h                                    # canvas heights per metre
    origin = 0.5 - (x0 + x1) / 2 * k / aspect        # canvas-width fraction of world x = 0
    members = []
    for p, gender in zip(pts, (g for _, g in actors)):
        hip_x = (p[8, 0] + p[11, 0]) / 2
        local = p.copy()
        local[:, 0] -= hip_x
        local[:, 1] -= floor
        hip_z = (p[8, 2] + p[11, 2]) / 2
        local[:, 2] -= hip_z
        local = np.round(local, 3)
        members.append({"body": local[:18].tolist(), "hands": [local[18:39].tolist(), local[39:60].tolist()],
                        "x": round(origin + hip_x * k / aspect, 4), "y": 0.92, "scale": round(s, 4), "z": round(float(hip_z), 3),
                        "label": "Her" if gender == "girl" else "Him", "gender": gender})
    lone = members[0]
    sub = pose_kind({"body": lone["body"]}) if len(members) == 1 else ""
    return {"id": pid, "name": name + (f" · {sub.lower()}" if sub and sub != "Other" else ""), "pack": "H scenes", "group": "",
            "kind": kind, "aspect": aspect, "members": members}


def _pick_clip(names: dict) -> str | None:
    for pat in LOOP_PREFS:
        for n in sorted(names):
            if re.search(pat, n):
                return n
    return next(iter(sorted(names)), None)


def _controllers(path: Path) -> dict[str, dict]:
    import UnityPy
    env = UnityPy.load(str(path))
    clips = {o.path_id: o for o in env.objects if o.type.name == "AnimationClip"}
    out = {}
    for o in env.objects:
        if o.type.name != "AnimatorController":
            continue
        d = o.read()
        if d.m_Name.endswith("_base"):
            continue
        names = {}
        for pp in d.m_AnimationClips:
            c = clips.get(pp.m_PathID)
            if c is not None:
                names.setdefault(c.peek_name() if hasattr(c, "peek_name") else c.read().m_Name, c)
        out[d.m_Name] = names
    return out


def build_h_library(src: Path, out: Path, log=print) -> dict:
    """Every position in abdata/h/anim as one group pose."""
    female, male = {}, {}
    for f in sorted((src / "female").glob("*.unity3d")):
        female.update(_controllers(f))
    for f in sorted((src / "male").glob("*.unity3d")):
        male.update(_controllers(f))
    log(f"[h] {len(female)} female and {len(male)} male positions")
    entries, done = [], set()
    count = {}
    for name in sorted(female):
        m = re.match(r"^(kh[a-z]3?)_f_(n?\d+)(?:_(\d+))?$", name)
        if not m:
            continue
        cat, num, part = m.group(1), m.group(2), m.group(3)
        key = f"{cat}_{num}"
        if key in done:
            continue
        done.add(key)
        actors = []
        fem = [female[name]] if part is None else [female.get(f"{cat}_f_{num}_{i:02d}") for i in range(2)]
        for clips in fem:
            if clips:
                c = clips.get(_pick_clip(clips))
                if c is not None:
                    actors.append((actor_points(c.read(), False), "girl"))
        mc = male.get(f"{cat}_m_{num}")
        if mc:
            c = mc.get(_pick_clip(mc))
            if c is not None:
                actors.append((actor_points(c.read(), True), "boy"))
        if not actors:
            continue
        kind = CATEGORIES.get(cat, "Adult")
        count[kind] = count.get(kind, 0) + 1
        label = kind.split("·")[-1].strip()
        try:
            entries.append(group_entry(f"h/{key}", f"{label} {count[kind]:02d}", kind, actors, 1.0 if len(actors) < 2 else 1.25))
        except Exception as e:  # noqa: BLE001
            log(f"[h] skipped {key}: {e}")
    lib = {"version": 1, "source": "Koikatsu H scenes", "count": len(entries), "poses": entries}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(lib, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    return {"count": len(entries), "path": str(out), "by_kind": count}
