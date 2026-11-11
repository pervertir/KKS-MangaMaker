"""Draw a Pose-tab scene as the OpenPose image ControlNet gets, without the browser (same projection and
colours as ui/static/pose.js). Used by the MCP server to pose shots."""
from __future__ import annotations

import colorsys
import math
import uuid

from PIL import Image, ImageDraw

FIG_H = 1.75
LIMBS = [(1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10), (1, 11), (11, 12), (12, 13), (1, 0), (0, 14), (14, 16), (0, 15), (15, 17)]
KCOL = [(255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0), (85, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170), (0, 255, 255),
        (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255), (170, 0, 255), (255, 0, 255), (255, 0, 170), (255, 0, 85)]
HAND_EDGES = [(0, 1), (1, 2), (2, 3), (3, 4), (0, 5), (5, 6), (6, 7), (7, 8), (0, 9), (9, 10), (10, 11), (11, 12), (0, 13), (13, 14), (14, 15), (15, 16),
              (0, 17), (17, 18), (18, 19), (19, 20)]
SWAP = [0, 1, 5, 6, 7, 2, 3, 4, 11, 12, 13, 8, 9, 10, 15, 14, 17, 16]
FRAMING = {"full": 1.0, "knees": 0.72, "waist": 0.5, "chest": 0.33, "close": 0.2}


def project(pose: dict, c: dict, W: int, H: int):
    k = c.get("scale", 0.85) * H / FIG_H
    yaw, pit, rol = (math.radians(c.get(a, 0)) for a in ("yaw", "pitch", "roll"))
    cy, sy, cp, sp, cr, sr = math.cos(yaw), math.sin(yaw), math.cos(pit), math.sin(pit), math.cos(rol), math.sin(rol)
    b = pose["body"]
    hip_y = (b[8][1] + b[11][1]) / 2
    ax, ay = c.get("x", 0.5) * W, c.get("y", 0.92) * H

    def tf(p):
        x, y, z = p
        if c.get("flip"):
            x = -x
        X, Z = x * cy + z * sy, -x * sy + z * cy
        Y = y - hip_y
        Y2, Z = Y * cp - Z * sp, Y * sp + Z * cp
        Y = Y2 + hip_y
        sx, syy = X * k, -(Y - hip_y) * k
        return (ax + sx * cr - syy * sr, ay - hip_y * k + sx * sr + syy * cr, Z)

    body = [tf(p) for p in b]
    hands = [[tf(p) for p in hd] for hd in (pose.get("hands") or [[], []])]
    if c.get("flip"):
        body, hands = [body[i] for i in SWAP], [hands[1], hands[0]]
    nz, hide = body[1][2], set()
    if body[0][2] < nz - 0.01:
        hide.add(0)
    hide |= {i for i in (14, 15) if body[i][2] < nz - 0.005}
    hide |= {i for i in (16, 17) if body[i][2] < nz - 0.09}
    return body, hands, hide


def render(scene: dict, poses: dict[str, dict], hands: bool = True) -> Image.Image:
    W, H = int(scene["w"]), int(scene["h"])
    im = Image.new("RGB", (W, H), "black")
    over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d, do = ImageDraw.Draw(im), ImageDraw.Draw(over)
    unit = min(W, H) / 1024
    stick, rad = max(1.5, unit * 4), max(1.5, unit * 4)
    figs = []
    for c in scene["chars"]:
        if c.get("hidden") or c.get("pose") not in poses:
            continue
        figs.append(project(poses[c["pose"]], c, W, H))
    for body, _, hide in figs:                       # limbs: translucent ellipses, as the preprocessors draw them
        for i, (a, b) in enumerate(LIMBS):
            if a in hide or b in hide:
                continue
            (x1, y1, _), (x2, y2, _) = body[a], body[b]
            mx, my, ln, ang = (x1 + x2) / 2, (y1 + y2) / 2, math.hypot(x2 - x1, y2 - y1) / 2, math.atan2(y2 - y1, x2 - x1)
            pts = [(mx + ln * math.cos(t) * math.cos(ang) - stick * math.sin(t) * math.sin(ang),
                    my + ln * math.cos(t) * math.sin(ang) + stick * math.sin(t) * math.cos(ang)) for t in [j * math.pi / 12 for j in range(24)]]
            do.polygon(pts, fill=KCOL[i] + (153,))
    im.paste(over, (0, 0), over)
    for body, hds, hide in figs:
        for i, (x, y, _) in enumerate(body):
            if i not in hide:
                d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=KCOL[i])
        if hands:
            for hd in hds:
                if not hd:
                    continue
                for e, (a, b) in enumerate(HAND_EDGES):
                    r, g, bb = colorsys.hsv_to_rgb(e / len(HAND_EDGES), 1, 1)
                    d.line([hd[a][:2], hd[b][:2]], fill=(int(r * 255), int(g * 255), int(bb * 255)), width=max(1, int(unit * 2)))
                for x, y, _ in hd:
                    rr = max(1, unit * 2)
                    d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(0, 0, 255))
    return im


def frame(scene: dict, poses: dict, how: str) -> None:
    """Shot framing presets (full, knees, waist, chest, close): scale and lift every figure like the Pose tab."""
    frac = FRAMING.get(how)
    if not frac:
        return
    W, H = scene["w"], scene["h"]
    for c in scene["chars"]:
        pose = poses.get(c["pose"])
        if not pose:
            continue
        def ext():
            body, hds, _ = project(pose, c, W, H)
            ys = [p[1] for p in body] + [p[1] for hd in hds for p in hd]
            return min(ys), max(ys)
        top, bot = ext()
        c["scale"] *= (H * 0.9) / (frac * max(1, bot - top))
        top, _ = ext()
        c["y"] += (H * 0.06 - top) / H


def new_char(pose_id: str, x: float, **kw) -> dict:
    c = {"id": uuid.uuid4().hex[:8], "pose": pose_id, "name": "", "series": "", "tags": "", "gender": "girl", "x": x, "y": 0.92, "scale": 0.85,
         "yaw": 0, "pitch": 0, "roll": 0, "flip": False, "hidden": False, "edits": {}, "label": "Character"}
    c.update({k: v for k, v in kw.items() if v is not None})
    return c
