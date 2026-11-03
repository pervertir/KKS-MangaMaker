"""Dialogue composition: place bubble templates from UserData/cap/Comics/Templates and fit text inside.

The bubble PNGs are RGBA cut-outs (about 4000 px). The text area is found from the alpha mask:
the largest rectangle (text aspect) around the opaque centroid that stays fully inside the bubble.
"""
from __future__ import annotations

import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def _font(path: str | None, px: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, px) if path else ImageFont.load_default(px)
    except OSError:
        return ImageFont.load_default(px)


def find_bubble(bubbles_dir: Path, key: str) -> Path:
    key = str(key).strip()
    if Path(key).is_absolute() and Path(key).exists():
        return Path(key)
    if (bubbles_dir / key).exists():
        return bubbles_dir / key
    num = re.sub(r"\D", "", key)
    if num:
        for p in bubbles_dir.glob(f"*-{int(num):03d}.png"):
            return p
    raise FileNotFoundError(f"bubble template '{key}' not found in {bubbles_dir}")


def _interior_rect(alpha: np.ndarray, aspect: float = 2.2) -> tuple[int, int, int, int]:
    """Largest rectangle with width/height ~ aspect fully inside alpha>128. Returns (x0, y0, x1, y1)."""
    mask = alpha > 128
    H, W = mask.shape
    if not mask.any():
        return 0, 0, W, H
    hole = (~mask).astype(np.int32)
    integ = np.pad(hole.cumsum(0).cumsum(1), ((1, 0), (1, 0)))

    def holes(x0, y0, x1, y1):
        return integ[y1, x1] - integ[y0, x1] - integ[y1, x0] + integ[y0, x0]

    ys, xs = np.nonzero(mask)
    cy0, cx0 = ys.mean(), xs.mean()
    best = (0, 0, 0, 0, 0)
    # try a small grid of centres around the centroid; the tail pulls the centroid a little
    for dy in np.linspace(-0.12, 0.12, 7):
        for dx in np.linspace(-0.12, 0.12, 7):
            cx, cy = cx0 + dx * W, cy0 + dy * H
            lo, hi = 1.0, float(min(W, H))
            while hi - lo > 1.0:
                s = (lo + hi) / 2
                hw, hh = s * aspect / 2, s / 2
                x0, y0, x1, y1 = int(cx - hw), int(cy - hh), int(cx + hw), int(cy + hh)
                ok = x0 >= 0 and y0 >= 0 and x1 <= W and y1 <= H and holes(x0, y0, x1, y1) == 0
                if ok:
                    lo = s
                else:
                    hi = s
            if lo > best[0]:
                best = (lo, cx, cy, 0, 0)
    s, cx, cy, _, _ = best
    hw, hh = s * aspect / 2, s / 2
    return int(cx - hw), int(cy - hh), int(cx + hw), int(cy + hh)


def _wrap(text: str, font, max_w: int, draw) -> list[str]:
    lines = []
    for para in text.split("\n"):
        words = para.split()
        cur = ""
        for w in words:
            t = (cur + " " + w).strip()
            if draw.textlength(t, font=font) <= max_w or not cur:
                cur = t
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
    return lines


def _fit_text(draw, text, font_path, box_w, box_h, min_px, max_px, spacing):
    for px in range(max_px, min_px - 1, -2):
        f = _font(font_path, px)
        lines = _wrap(text, f, box_w, draw)
        lh = int(px * spacing)
        if all(draw.textlength(l, font=f) <= box_w for l in lines) and lh * len(lines) <= box_h:
            return f, lines, lh
    f = _font(font_path, min_px)
    return f, _wrap(text, f, box_w, draw), int(min_px * spacing)


def _px(v, total):
    return int(v * total) if isinstance(v, float) and v <= 1.0 else int(v)


def _auto_color(rgb_region: np.ndarray) -> tuple[int, int, int]:
    if rgb_region.size == 0:
        return (0, 0, 0)
    lum = (0.299 * rgb_region[..., 0] + 0.587 * rgb_region[..., 1] + 0.114 * rgb_region[..., 2]).mean()
    return (0, 0, 0) if lum > 128 else (255, 255, 255)


def _parse_color(c, fallback):
    if c in (None, "auto"):
        return fallback
    if isinstance(c, (list, tuple)):
        return tuple(int(x) for x in c)
    c = str(c).lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def compose(image_path: Path, dialogue: list[dict], cfg_compose: dict, bubbles_dir: Path, out_path: Path, log=print) -> Path:
    base = Image.open(image_path).convert("RGBA")
    W, H = base.size
    font_path = cfg_compose.get("font")
    font_bold = cfg_compose.get("font_bold", font_path)
    min_px, max_px = int(cfg_compose.get("min_font_px", 14)), int(cfg_compose.get("max_font_px", 96))
    spacing = float(cfg_compose.get("line_spacing", 1.15))

    for i, d in enumerate(dialogue):
        text = str(d.get("text", "")).strip()
        kind = str(d.get("bubble", cfg_compose.get("bubble_default", "001")))
        at = d.get("at", [0.5, 0.15])
        cx, cy = _px(float(at[0]), W), _px(float(at[1]), H)
        size = d.get("size", cfg_compose.get("bubble_size", 0.38))
        bw = _px(float(size), W)
        fp = font_bold if d.get("bold") else font_path
        draw = ImageDraw.Draw(base)

        if kind in ("none", "sfx"):
            f, lines, lh = _fit_text(draw, text, fp, bw, int(bw * 0.6), min_px, int(d.get("font_px") or max_px), spacing)
            color = _parse_color(d.get("color"), (255, 255, 255))
            y = cy - lh * len(lines) // 2
            for l in lines:
                tw = draw.textlength(l, font=f)
                x = cx - tw / 2
                if kind == "sfx":
                    draw.text((x, y), l, font=f, fill=color, stroke_width=max(2, f.size // 10), stroke_fill=d.get("stroke", (0, 0, 0)))
                else:
                    draw.text((x, y), l, font=f, fill=color)
                y += lh
            continue

        if kind in ("box", "caption"):
            pad = int(bw * 0.05)
            f, lines, lh = _fit_text(draw, text, fp, bw - 2 * pad, int(bw * 0.5), min_px, int(d.get("font_px") or max_px), spacing)
            bh = lh * len(lines) + 2 * pad
            x0, y0 = cx - bw // 2, cy - bh // 2
            fill = _parse_color(d.get("fill"), (255, 255, 255) if kind == "box" else (255, 240, 170))
            draw.rectangle([x0, y0, x0 + bw, y0 + bh], fill=fill, outline=(0, 0, 0), width=max(2, bw // 120))
            color = _parse_color(d.get("color"), (0, 0, 0))
            y = y0 + pad
            for l in lines:
                tw = draw.textlength(l, font=f)
                draw.text((cx - tw / 2, y), l, font=f, fill=color)
                y += lh
            continue

        # template bubble
        bpath = find_bubble(bubbles_dir, kind)
        bub = Image.open(bpath).convert("RGBA")
        scale = bw / bub.width
        bub = bub.resize((bw, max(1, int(bub.height * scale))), Image.LANCZOS)
        if d.get("flip"):
            bub = bub.transpose(Image.FLIP_LEFT_RIGHT)
        if d.get("rotate"):
            bub = bub.rotate(float(d["rotate"]), expand=True, resample=Image.BICUBIC)
        alpha = np.array(bub.getchannel("A"))
        x0, y0, x1, y1 = _interior_rect(alpha, aspect=float(d.get("text_aspect", 2.2)))
        inner_w, inner_h = max(10, int((x1 - x0) * 0.92)), max(10, int((y1 - y0) * 0.88))
        rgb = np.array(bub.convert("RGB"))[y0:y1, x0:x1]
        color = _parse_color(d.get("color"), _auto_color(rgb))
        px, py = cx - bub.width // 2, cy - bub.height // 2
        if d.get("clamp", True):  # keep the bubble inside the image when it fits
            px = min(max(px, 0), max(0, W - bub.width))
            py = min(max(py, 0), max(0, H - bub.height))
        layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        layer.paste(bub, (px, py), bub)
        base.alpha_composite(layer)
        draw = ImageDraw.Draw(base)
        f, lines, lh = _fit_text(draw, text, fp, inner_w, inner_h, min_px, int(d.get("font_px") or max_px), spacing)
        tcx, tcy = px + (x0 + x1) // 2, py + (y0 + y1) // 2
        y = tcy - lh * len(lines) // 2
        for l in lines:
            tw = draw.textlength(l, font=f)
            draw.text((tcx - tw / 2, y), l, font=f, fill=color)
            y += lh
        log(f"[compose] {i + 1}: bubble {bpath.name} at ({cx},{cy}) font {f.size}px, {len(lines)} line(s)")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    base.convert("RGB").save(out_path, quality=95)
    return out_path
