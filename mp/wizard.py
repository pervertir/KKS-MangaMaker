"""The Script Wizard without the browser: plain-text scene -> editor project (pages, panels, lettering)
and the shot list for it. Same rules as ui/static/wizard.js, so a script gives the same pages whether
it is pasted into the editor or sent through the MCP server.

Format (one thing per line; see docs/SCRIPT_WIZARD.md):
    ---                          new page          # 4-koma   page as four equal strips      # note
    Title: MY MANGA              big title on the page
    [Rem, Ram] prompt words      a new panel: who is in it (left to right), then the render prompt
    ! [Rem] prompt words         "!" = big panel
    Rem: line                    speech            Rem (thought|shout|whisper): line
    Caption: text                SFX: text
"""
from __future__ import annotations

import math
import random
import re
import uuid

PAGE_W, PAGE_H = 1800, 2700
SHAPE = {"say": "oval", "think": "cloud", "shout": "burst", "whisper": "whisper"}
_SPEAKER = re.compile(r"^([^:\[\]!]{1,40}?)\s*(?:\((thought|think|thinking|whisper|whispering|shout|shouting|yell)\))?\s*:\s*(.+)$", re.I)


def parse_script(text: str, max_per_page: int = 6) -> list[dict]:
    """[{"panels": [{desc, chars, big, lines: [{kind, who, text}]}], "koma": bool, "title": str|None}]"""
    pages = [{"panels": [], "koma": False, "title": None}]
    cur = None

    def new_panel(desc, chars, big):
        nonlocal cur
        cur = {"desc": desc, "chars": chars, "big": big, "lines": []}
        pages[-1]["panels"].append(cur)
        return cur

    for raw in str(text).split("\n"):
        line = raw.strip()
        if not line:
            continue
        if re.match(r"^(-{3,}|#\s*page\b.*|page\s*\d*\s*:?)$", line, re.I):
            if pages[-1]["panels"]:
                pages.append({"panels": [], "koma": False, "title": None})
            cur = None
            continue
        if line.startswith("#"):
            if re.search(r"4[\s-]?koma|yonkoma", line, re.I):
                pages[-1]["koma"] = True
            continue
        m = re.match(r"^title\s*:\s*(.+)$", line, re.I)
        if m:
            pages[-1]["title"] = m.group(1).strip()
            continue
        m = re.match(r"^(caption|narration|sfx)\s*:\s*(.+)$", line, re.I)
        if m:
            (cur or new_panel("", [], False))["lines"].append({"kind": "sfx" if m.group(1).lower() == "sfx" else "caption", "text": m.group(2).strip()})
            continue
        m = _SPEAKER.match(line)
        if m and not re.search(r"\s{2,}", m.group(1)) and len(m.group(1).split()) <= 4:
            who, mood, said = m.group(1).strip(), (m.group(2) or "").lower(), m.group(3).strip()
            if mood.startswith("th"):
                kind = "think"
            elif mood.startswith("wh"):
                kind = "whisper"
            elif mood.startswith("sh") or mood == "yell" or re.search(r"!{2,}$", said) or (len(said) > 3 and said == said.upper() and re.search(r"[A-Z]", said)):
                kind = "shout"
            else:
                kind = "say"
            p = cur or new_panel("", [], False)
            if not any(c.lower() == who.lower() for c in p["chars"]):
                p["chars"].append(who)
            p["lines"].append({"kind": kind, "who": who, "text": said})
            continue
        m = re.match(r"^(!)?\s*(?:\[([^\]]*)\])?\s*(.*)$", line)
        new_panel(m.group(3).strip(), [c.strip() for c in (m.group(2) or "").split(",") if c.strip()], bool(m.group(1)))
    out = []
    for pg in pages:
        ps = pg["panels"]
        for i in range(0, len(ps), max_per_page):
            out.append({"panels": ps[i:i + max_per_page], "koma": pg["koma"], "title": pg["title"] if i == 0 else None})
    return [p for p in out if p["panels"]]


def page_rows(pg: dict) -> tuple[list[list[float]], list[float]]:
    """Rows of relative panel widths and relative row heights; big panels get a row of their own."""
    panels = pg["panels"]
    n = len(panels)
    if pg.get("koma"):
        return [[1] for _ in panels], [1 for _ in panels]
    rows, hs, i = [], [], 0
    while i < n:
        p = panels[i]
        if p["big"] or n <= 3:
            rows.append([1]); hs.append(1.7 if p["big"] else 1); i += 1; continue
        left = n - i
        nxt = panels[i + 1] if i + 1 < n else None
        if left == 1 or (nxt and nxt["big"]):
            rows.append([1]); hs.append(1); i += 1; continue
        three = left >= 7 and not (i + 2 < n and panels[i + 2]["big"])
        rows.append([1, 1, 1] if three else [1.15, 1]); hs.append(1); i += 3 if three else 2
    return rows, hs


def grid_rects(rows, heights, margin=60, gutter=30, line=4) -> list[tuple[float, float, float, float]]:
    av_h = PAGE_H - 2 * margin - gutter * (len(rows) - 1)
    out, y = [], margin
    for row, hr in zip(rows, heights):
        hh = av_h * hr / sum(heights)
        av_w = PAGE_W - 2 * margin - gutter * (len(row) - 1)
        x = margin
        for cw in row:
            w = av_w * cw / sum(row)
            out.append((x + line, y + line, w - 2 * line, hh - 2 * line))
            x += w + gutter
        y += hh + gutter
    return out


def reading_order(rects, rtl: bool):
    rows = []
    for r in sorted(rects, key=lambda r: r[1]):
        row = next((rw for rw in rows if r[1] < rw[0][1] + min(q[3] for q in rw) * 0.5), None)
        (row.append(r) if row is not None else rows.append([r]))
    return [r for row in rows for r in sorted(row, key=(lambda q: -(q[0] + q[2])) if rtl else (lambda q: q[0]))]


def _clamp(v, a, b):
    return max(a, min(b, v))


def lettering(panel: tuple, p: dict, rtl: bool) -> list[dict]:
    x0, y0, pw, ph = panel
    out, prev = [], None
    pad, max_w = max(24, pw * 0.03), max(220, pw * 0.46)
    for ln in [l for l in p["lines"] if l["kind"] not in ("caption", "sfx")]:
        n = len(ln["text"])
        bw = _clamp(150 + math.sqrt(n) * 40, 220, max_w)
        bh = _clamp(bw * (0.5 + min(n, 160) / 400), 130, ph * 0.4)
        start = x0 + pw - pad - bw if rtl else x0 + pad
        if prev is None:
            x, y = start, y0 + pad
        else:
            beside = prev[0] - 12 - bw if rtl else prev[0] + prev[2] + 12
            if (beside >= x0 + pad) if rtl else (beside + bw <= x0 + pw - pad):
                x, y = beside, prev[1] + prev[3] * 0.35
            else:
                x, y = start, prev[1] + prev[3] + 10
        x = _clamp(x, x0 + 4, x0 + pw - bw - 4)
        y = _clamp(y, y0 + 4, y0 + ph - bh - 4)
        prev = (x, y, bw, bh)
        who = next((i for i, c in enumerate(p["chars"]) if c.lower() == (ln.get("who") or "").lower()), -1)
        tx = x0 + pw * (0.5 if who < 0 else (who + 1) / (len(p["chars"]) + 1))
        ty = y0 + ph * 0.62
        dx, dy = tx - (x + bw / 2), ty - (y + bh / 2)
        f = 1.45 / max(0.01, math.hypot(dx / (bw / 2), dy / (bh / 2)))
        shape = SHAPE[ln["kind"]]
        out.append({"type": "vbubble", "shape": shape, "x": x, "y": y, "w": bw, "h": bh, "text": ln["text"],
                    "seed": random.randrange(1_000_000), "tail": None if shape == "burst" and not ln.get("who") else {"x": dx * f, "y": max(dy * f, bh * 0.3)},
                    "font": "Bangers" if shape == "burst" else "MMComic", "bold": shape == "burst"})
    for k, ln in enumerate([l for l in p["lines"] if l["kind"] == "caption"]):
        w, hh = min(pw * 0.5, 560), _clamp(70 + len(ln["text"]) * 1.2, 90, 200)
        out.append({"type": "caption", "x": x0 + 10 if rtl else x0 + pw - w - 10, "y": y0 + 10 + k * (hh + 10), "w": w, "h": hh, "text": ln["text"], "fill": "#ffffff"})
    for k, ln in enumerate([l for l in p["lines"] if l["kind"] == "sfx"]):
        w, hh = min(pw * 0.55, 620), min(ph * 0.3, 240)
        out.append({"type": "text", "sfx": True, "x": x0 + pw * (0.08 if rtl else 0.37) + k * 40, "y": y0 + ph * 0.55 - k * 40, "w": w, "h": hh,
                    "text": ln["text"], "rotate": 8 if k % 2 else -8, "color": "#ffffff", "stroke": "#000000", "strokeWidth": 12, "font": "Bangers", "fontSize": 0})
    return out


def build_document(pages: list[dict], title: str = "Chapter", reading: str = "rtl", shot_prefix: str = "ch1",
                   series: str = "", make_shots: bool = True, first_page: int = 1) -> tuple[dict, list[dict]]:
    """(editor project document, shots to create [{name, prompt, characters}])."""
    rtl = reading != "ltr"
    doc_pages, shots = [], []
    for n, pg in enumerate(pages, start=first_page):
        rows, hs = page_rows(pg)
        rects = grid_rects([list(reversed(r)) if rtl else r for r in rows], hs)
        order = reading_order(rects, rtl)
        layers = [{"id": uuid.uuid4().hex[:8], "type": "panel", "x": r[0], "y": r[1], "w": r[2], "h": r[3], "shot": "", "image": None} for r in rects]
        by_rect = {tuple(r): l for r, l in zip(rects, layers)}
        texts = []
        for i, r in enumerate(order):
            if i >= len(pg["panels"]):
                break
            p, layer = pg["panels"][i], by_rect[tuple(r)]
            if make_shots and (p["desc"] or p["chars"]):
                layer["shot"] = f"{shot_prefix}_p{n:02d}_{i + 1}"
                shots.append({"name": layer["shot"], "prompt": p["desc"], "characters": [{"name": c, "series": series} for c in p["chars"]]})
            texts += lettering(r, p, rtl)
        if pg.get("title"):
            texts.insert(0, {"type": "text", "x": PAGE_W * 0.1, "y": PAGE_H * 0.05, "w": PAGE_W * 0.8, "h": PAGE_H * 0.14, "text": pg["title"],
                             "font": "Anton", "color": "#ffffff", "stroke": "#000000", "strokeWidth": 14, "fontSize": 0})
        for t in texts:
            t["id"] = uuid.uuid4().hex[:8]
        doc_pages.append({"id": uuid.uuid4().hex[:8], "bg": "#ffffff", "layers": layers + texts})
    doc = {"version": 1, "title": title, "reading": "ltr" if not rtl else "rtl", "width": PAGE_W, "height": PAGE_H, "maxFont": 56, "pages": doc_pages}
    return doc, shots


def summarize(pages: list[dict]) -> dict:
    """What the wizard would build, plus warnings a writer should fix."""
    warn, cast = [], {}
    for pi, pg in enumerate(pages, 1):
        for i, p in enumerate(pg["panels"], 1):
            for c in p["chars"]:
                cast[c] = cast.get(c, 0) + 1
            if not p["desc"] and not p["chars"]:
                warn.append(f"page {pi} panel {i}: no description and nobody in it (the render has nothing to draw)")
            if len(p["chars"]) > 3:
                warn.append(f"page {pi} panel {i}: {len(p['chars'])} characters; renders get unreliable past 3")
            talk = [l for l in p["lines"] if l["kind"] not in ("sfx", "caption")]
            if len(talk) > 3:
                warn.append(f"page {pi} panel {i}: {len(talk)} lines of dialogue; more than 3 crowds a panel, split it")
            for l in talk:
                if len(l["text"]) > 120:
                    warn.append(f"page {pi} panel {i}: a line of {len(l['text'])} characters; keep bubbles under ~100")
    return {"pages": len(pages), "panels": sum(len(p["panels"]) for p in pages), "characters": cast, "warnings": warn,
            "layout": [{"page": i + 1, "panels": len(p["panels"]), "big": sum(1 for q in p["panels"] if q["big"]), "4koma": p["koma"], "title": p["title"]}
                       for i, p in enumerate(pages)]}
