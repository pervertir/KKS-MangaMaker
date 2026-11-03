"""Manga pages: lay shot renders into panel layouts and composite the dialogue on top.

A script (scripts/<name>.yaml) lists pages; each page picks a layout and fills its panels with shots:

    title: Chapter 1
    reading: rtl                  rtl = manga order (right to left), ltr = western
    shots_dir: shots              where `shot:` names are looked up (relative to MangaPipeline/)
    scale: 1.0                    page size multiplier (templates are 1800x2700)
    font_px: 0                    one text size for every bubble; 0 = fit each bubble up to max_font_px
    max_font_px: 56               cap for fitted text (config compose.page_max_font_px), keeps a page even
    pages:
      - layout: 13                Comic Strips/Template-13.png (1-100), a file path, or a grid:
                                  {rows: [[1], [1, 1], [2, 1]], heights: [2, 1, 1]}
        panels:                   filled in reading order; `panel: N` pins one (1-based, reading order)
          - shot: ch1_s01         shots/ch1_s01/out/render_*.png (newest); `image:` picks a file
            image: render_123_00.png   (inside out/, or any path)
            fit: cover            cover (crop to fill) | contain (letterbox)
            focus: [0.5, 0.3]     crop anchor for cover, fractions of the render
            zoom: 1.0             >1 crops tighter around `focus`
            flip: false           mirror the render
            dialogue: [...]       shot.yaml dialogue keys; `at` and `size` are relative to the panel.
                                  Missing key = the shot's own shot.yaml dialogue. [] = none.
                                  Missing `at` = auto-placed along the top in reading order.
        dialogue: [...]           page-level text (captions, sfx), relative to the whole page

Missing renders draw as grey placeholders with the shot name, so a chapter can be laid out first.
"""
from __future__ import annotations

import glob
import json
from pathlib import Path

import numpy as np
import yaml
from PIL import Image, ImageChops, ImageDraw, ImageOps

from .compose import _font, draw_dialogue
from .sidecar import SIDECAR_NAMES

STRIPS_SUBDIR = "Comic Strips"
GRID_SIZE = (1800, 2700)
GRID_MARGIN, GRID_GUTTER, GRID_LINE = 60, 30, 4


class PageError(Exception):
    pass


# ---------------------------------------------------------------------------- layouts
def detect_panels(img: Image.Image) -> list[tuple[int, int, int, int]]:
    """Panel rectangles (x, y, w, h) of a white page with dark panel borders: every enclosed
    white region that is not connected to the page edge and is big enough to be a panel."""
    from scipy import ndimage

    g = np.array(img.convert("L"))
    white = g > 200
    lab, n = ndimage.label(white)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    H, W = g.shape
    rects = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None or i in edge:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        if (x1 - x0) * (y1 - y0) < 0.01 * W * H:
            continue
        rects.append((x0, y0, x1 - x0, y1 - y0))
    return rects


def reading_order(rects: list[tuple], rtl: bool = True) -> list[tuple]:
    """Rows top to bottom (a panel joins the row whose top it starts within), then right to left
    (rtl) or left to right inside each row."""
    rows: list[list[tuple]] = []
    for r in sorted(rects, key=lambda r: r[1]):
        for row in rows:
            top, h = row[0][1], min(q[3] for q in row)
            if r[1] < top + h * 0.5:
                row.append(r)
                break
        else:
            rows.append([r])
    out = []
    for row in rows:
        out += sorted(row, key=lambda r: -(r[0] + r[2]) if rtl else r[0])
    return out


def grid_layout(spec: dict, scale: float) -> tuple[Image.Image, list[tuple]]:
    W, H = int(GRID_SIZE[0] * scale), int(GRID_SIZE[1] * scale)
    m, gut, lw = int(GRID_MARGIN * scale), int(GRID_GUTTER * scale), max(2, int(GRID_LINE * scale))
    rows = spec.get("rows") or [[1]]
    heights = spec.get("heights") or [1] * len(rows)
    if len(heights) != len(rows):
        raise PageError("grid layout: `heights` needs one entry per row")
    page = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(page)
    rects = []
    avail_h = H - 2 * m - gut * (len(rows) - 1)
    y = m
    for row, rh in zip(rows, heights):
        h = int(avail_h * rh / sum(heights))
        avail_w = W - 2 * m - gut * (len(row) - 1)
        x = m
        for cw in row:
            w = int(avail_w * cw / sum(row))
            draw.rectangle([x, y, x + w - 1, y + h - 1], outline="black", width=lw)
            rects.append((x + lw, y + lw, w - 2 * lw, h - 2 * lw))
            x += w + gut
        y += h + gut
    return page, rects


def load_layout(layout, templates_dir: Path, scale: float) -> tuple[Image.Image, list[tuple]]:
    """(page background with borders, panel rects in natural top-left order)."""
    if isinstance(layout, dict):
        return grid_layout(layout, scale)
    p = Path(str(layout)).expanduser()
    if not p.is_absolute() or not p.exists():
        key = str(layout).strip()
        num = key[len("Template-"):].split(".")[0] if key.startswith("Template-") else key
        if not num.isdigit():
            raise PageError(f"layout '{layout}': use a Comic Strips template number (1-100), a file, or {{rows: ...}}")
        p = templates_dir / STRIPS_SUBDIR / f"Template-{int(num):02d}.png"
    if not p.exists():
        raise PageError(f"layout template not found: {p}")
    bg = Image.open(p).convert("RGB")
    rects = detect_panels(bg)
    if not rects:
        raise PageError(f"no panels found in {p.name} (expects white panels inside dark borders)")
    if scale != 1.0:
        bg = bg.resize((int(bg.width * scale), int(bg.height * scale)), Image.LANCZOS)
        rects = [tuple(int(v * scale) for v in r) for r in rects]
    return bg, rects


# ----------------------------------------------------------------------------- panels
def _shot_dir(panel: dict, shots_dir: Path) -> Path | None:
    s = panel.get("shot")
    if not s:
        return None
    d = Path(str(s)).expanduser()
    return d if d.is_absolute() else shots_dir / d


def _shot_dialogue(shot_dir: Path | None) -> list[dict]:
    if shot_dir is None:
        return []
    for n in SIDECAR_NAMES:
        p = shot_dir / n
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f) if p.suffix == ".json" else (yaml.safe_load(f) or {})
            return list(data.get("dialogue") or [])
    return []


def find_render(panel: dict, shot_dir: Path | None, base_dir: Path) -> Path | None:
    img = panel.get("image")
    if img:
        cands = [Path(str(img)).expanduser()]
        if shot_dir is not None:
            cands = [shot_dir / "out" / img, shot_dir / img] + cands
        cands.append(base_dir / img)
        for c in cands:
            if c.is_absolute() and c.exists():
                return c
        raise PageError(f"image '{img}' not found for shot {panel.get('shot')}")
    if shot_dir is None:
        return None
    renders = sorted(glob.glob(str(shot_dir / "out" / "render_*.png")), key=lambda f: Path(f).stat().st_mtime)
    return Path(renders[-1]) if renders else None


def fit_image(src: Image.Image, w: int, h: int, fit: str = "cover", focus=(0.5, 0.5), zoom: float = 1.0) -> Image.Image:
    src = src.convert("RGB")
    if fit == "contain":
        out = Image.new("RGB", (w, h), "white")
        im = ImageOps.contain(src, (w, h), Image.LANCZOS)
        out.paste(im, ((w - im.width) // 2, (h - im.height) // 2))
        return out
    s = max(w / src.width, h / src.height) * max(1.0, float(zoom))
    sw, sh = src.width * s, src.height * s
    fx, fy = float(focus[0]), float(focus[1])
    x0 = min(max(fx * sw - w / 2, 0), sw - w)
    y0 = min(max(fy * sh - h / 2, 0), sh - h)
    box = (x0 / s, y0 / s, (x0 + w) / s, (y0 + h) / s)
    return src.resize((w, h), Image.LANCZOS, box=box)


def placeholder(w: int, h: int, label: str, font_path: str | None) -> Image.Image:
    im = Image.new("RGB", (w, h), (205, 205, 205))
    d = ImageDraw.Draw(im)
    d.line([(0, 0), (w, h)], fill=(175, 175, 175), width=3)
    d.line([(0, h), (w, 0)], fill=(175, 175, 175), width=3)
    f = _font(font_path, max(18, min(w, h) // 12))
    tw = d.textlength(label, font=f)
    d.text(((w - tw) / 2, h / 2 - f.size / 2), label, font=f, fill=(90, 90, 90))
    return im


def auto_place(dialogue: list[dict], rtl: bool) -> list[dict]:
    """Fill in `at` for entries without one: a row along the panel top, first line nearest the
    reading start (top-right for rtl), stepping across and slightly down."""
    todo = [i for i, d in enumerate(dialogue) if "at" not in d and str(d.get("bubble", "")) not in ("sfx", "none")]
    n = len(todo)
    out = [dict(d) for d in dialogue]
    for k, i in enumerate(todo):
        d = out[i]
        t = k / (n - 1) if n > 1 else 0.0
        x = 0.72 - 0.44 * t if rtl else 0.28 + 0.44 * t
        d["at"] = [round(x, 3), round(0.14 + 0.1 * k, 3)]
        d.setdefault("size", 0.42 if n == 1 else max(0.28, 0.8 / n))
        if not rtl:
            d.setdefault("flip", True)
    return out


# ------------------------------------------------------------------------------ pages
def load_script(path: Path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not data.get("pages"):
        raise PageError(f"{path}: no `pages:` list")
    return data


def build_page(page: dict, script: dict, cfg, base_dir: Path, log=print) -> Image.Image:
    rtl = str(page.get("reading", script.get("reading", "rtl"))).lower() != "ltr"
    scale = float(script.get("scale", 1.0))
    shots_dir = (base_dir / script.get("shots_dir", "shots")).resolve()
    bg, rects = load_layout(page.get("layout", 1), cfg.templates_dir, scale)
    rects = reading_order(rects, rtl)
    panels = page.get("panels") or []
    if len(panels) > len(rects):
        raise PageError(f"layout {page.get('layout')} has {len(rects)} panels, the page lists {len(panels)}")

    # assign: pinned panels first, the rest fill the remaining slots in reading order
    slots: dict[int, dict] = {}
    for p in panels:
        if p.get("panel") is not None:
            i = int(p["panel"]) - 1
            if not 0 <= i < len(rects) or i in slots:
                raise PageError(f"panel: {p['panel']} is out of range or used twice")
            slots[i] = p
    free = [i for i in range(len(rects)) if i not in slots]
    for p in panels:
        if p.get("panel") is None:
            slots[free.pop(0)] = p

    comp = dict(cfg.compose)
    if script.get("font_px"):
        comp["max_font_px"] = comp["min_font_px"] = int(int(script["font_px"]) * scale)
    else:
        comp["max_font_px"] = int(int(script.get("max_font_px", comp.get("page_max_font_px", 56))) * scale)
    font_path = comp.get("font")

    art = Image.new("RGB", bg.size, "white")
    texts = []
    for i, r in enumerate(rects):
        p = slots.get(i)
        if p is None:
            continue
        x, y, w, h = r
        sd = _shot_dir(p, shots_dir)
        src = find_render(p, sd, base_dir)
        if src is None:
            label = p.get("shot") or f"panel {i + 1}"
            log(f"[page] panel {i + 1}: no render for {label}; placeholder")
            im = placeholder(w, h, str(label), font_path)
        else:
            im = fit_image(Image.open(src), w, h, p.get("fit", "cover"), p.get("focus", (0.5, 0.5)), p.get("zoom", 1.0))
            log(f"[page] panel {i + 1}: {src.parent.parent.name}/{src.name}")
        if p.get("flip"):
            im = ImageOps.mirror(im)
        art.paste(im, (x, y))
        dlg = p["dialogue"] if "dialogue" in p else _shot_dialogue(sd)
        if dlg:
            texts.append((auto_place(dlg, rtl), r))

    # borders on top of the art: multiply keeps the black lines and the white gutters
    page_img = ImageChops.multiply(art, bg).convert("RGBA")
    W, H = page_img.size
    for dlg, r in texts:
        draw_dialogue(page_img, dlg, comp, cfg.bubbles_dir, rect=r, bounds=(0, 0, W, H), log=log)
    if page.get("dialogue"):
        draw_dialogue(page_img, auto_place(page["dialogue"], rtl), comp, cfg.bubbles_dir, log=log)
    return page_img.convert("RGB")


def build_script(script_path: Path, cfg, out_dir: Path | None, only: list[int] | None, pdf: bool, log=print) -> list[Path]:
    script_path = Path(script_path).resolve()
    script = load_script(script_path)
    base_dir = Path(__file__).resolve().parent.parent
    out_dir = out_dir or base_dir / "pages" / script_path.stem
    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for n, page in enumerate(script["pages"], start=1):
        if only and n not in only:
            continue
        log(f"[page] {n}: layout {page.get('layout', 1)}")
        img = build_page(page, script, cfg, base_dir, log)
        dest = out_dir / f"page_{n:02d}.png"
        img.save(dest)
        log(f"[page] -> {dest}")
        files.append(dest)
    if pdf and files:
        ims = [Image.open(f).convert("RGB") for f in files]
        dest = out_dir / f"{script_path.stem}.pdf"
        ims[0].save(dest, save_all=True, append_images=ims[1:], resolution=300)
        log(f"[page] -> {dest}")
    return files


def layout_sheet(cfg, dest: Path, rtl: bool = True, cols: int = 10) -> Path:
    """Contact sheet of every Comic Strips template with its number and panel order."""
    d = cfg.templates_dir / STRIPS_SUBDIR
    temps = sorted(d.glob("Template-*.png"), key=lambda p: int(p.stem.split("-")[1]))
    tw, th, lab = 180, 270, 26
    rows = (len(temps) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (tw + 10) + 10, rows * (th + lab + 10) + 10), (120, 120, 120))
    f_big, f_small = _font(None, 18), _font(None, 16)
    for k, p in enumerate(temps):
        bg = Image.open(p).convert("RGB")
        rects = reading_order(detect_panels(bg), rtl)
        s = tw / bg.width
        t = bg.resize((tw, th), Image.LANCZOS)
        dr = ImageDraw.Draw(t)
        for j, (x, y, w, h) in enumerate(rects, start=1):
            dr.text(((x + w / 2) * s - 5, (y + h / 2) * s - 9), str(j), font=f_small, fill=(200, 0, 0))
        x0, y0 = 10 + (k % cols) * (tw + 10), 10 + (k // cols) * (th + lab + 10)
        sheet.paste(t, (x0, y0 + lab))
        ImageDraw.Draw(sheet).text((x0, y0 + 2), f"{p.stem.split('-')[1]}  ({len(rects)})", font=f_big, fill="white")
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest)
    return dest
