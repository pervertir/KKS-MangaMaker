"""Book exports built from an editor project: a webtoon strip, CBZ, fixed-layout EPUB 3 and a print PDF.

They all read pages/<name>/project.json and the page images the editor exports next to it (page_NN.png, one per
page slot; a two-page spread fills two slots and may also leave spread_NN.png). Output goes to pages/<name>/export/.
"""
from __future__ import annotations

import io
import math
import os
import uuid
import zipfile
import zlib
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image

MM = 25.4
V1_PAGE_MM = 182.0
LETTERING = ("bubble", "vbubble", "text", "caption")
WEBTOON_PRESETS = {"webtoon": {"width": 800, "slice": 1280}}
CMYK_PROFILES = [
    "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc",
    "/usr/share/color/icc/ghostscript/default_cmyk.icc",
    "/usr/share/ghostscript/iccprofiles/default_cmyk.icc",
]


class ExportError(Exception):
    pass


# ------------------------------------------------------------------------------ book
def page_format(doc: dict) -> dict:
    """doc.format in mm (+ dpi). Older projects have none: their 1800 px canvas is 182 mm wide with 3 mm bleed."""
    f = dict(doc.get("format") or {})
    w, h = doc.get("width", 1800), doc.get("height", 2700)
    f.setdefault("bleed", 3.0)
    f.setdefault("safe", 5.0)
    f.setdefault("dpi", w / (V1_PAGE_MM / MM))
    f.setdefault("trimW", w * MM / f["dpi"] - 2 * f["bleed"])
    f.setdefault("trimH", h * MM / f["dpi"] - 2 * f["bleed"])
    f.setdefault("colour", "colour")
    f["binding"] = f.get("binding") or ("ltr" if doc.get("reading") == "ltr" else "rtl")
    return f


def slots(doc: dict) -> list[dict]:
    """One entry per page slot: {n, page, half}. half is None for a single page, else 'first'/'second' of a spread."""
    out, n = [], 1
    for i, p in enumerate(doc.get("pages") or []):
        if p.get("span") == 2:
            out += [{"n": n, "page": i, "half": "first"}, {"n": n + 1, "page": i, "half": "second"}]
            n += 2
        else:
            out.append({"n": n, "page": i, "half": None})
            n += 1
    return out


def chapters(doc: dict) -> list[tuple[str, int]]:
    """(title, first slot) for every page that starts a chapter; the whole book is one chapter when none is set."""
    out = []
    for s in slots(doc):
        title = (doc["pages"][s["page"]].get("chapter") or "").strip()
        if title and s["half"] != "second":
            out.append((title, s["n"]))
    return out or [(doc.get("title") or "Untitled", 1)]


def slot_files(d: Path, doc: dict) -> list[Path]:
    files = [d / f"page_{s['n']:02d}.png" for s in slots(doc)]
    missing = [f.name for f in files if not f.exists()]
    if missing:
        raise ExportError(f"export the pages first: missing {', '.join(missing[:5])}{' …' if len(missing) > 5 else ''}")
    return files


def spread_side(n: int, binding: str) -> str:
    """Which side of an open book slot n sits on: odd slots are recto, which is the right page in a left-to-right
    book and the left page in a right-to-left one."""
    recto = n % 2 == 1
    return ("left" if recto else "right") if binding == "rtl" else ("right" if recto else "left")


# ------------------------------------------------------------------------------ webtoon
def _bbox(l: dict) -> tuple[float, float, float, float]:
    x, y, w, h, a = l.get("x", 0), l.get("y", 0), l.get("w", 0), l.get("h", 0), math.radians(l.get("rotate") or 0)
    if not a:
        return x, y, x + w, y + h
    cx, cy, c, s = x + w / 2, y + h / 2, abs(math.cos(a)), abs(math.sin(a))
    hw, hh = (w * c + h * s) / 2, (w * s + h * c) / 2
    return cx - hw, cy - hh, cx + hw, cy + hh


def reading_order(rects: list[tuple], rtl: bool) -> list[tuple]:
    """The editor's panelOrder on (x0, y0, x1, y1) boxes: rows top to bottom, then right to left (rtl)."""
    rows: list[list[tuple]] = []
    for r in sorted(rects, key=lambda r: r[1]):
        for row in rows:
            if r[1] < row[0][1] + min(q[3] - q[1] for q in row) * 0.5:
                row.append(r)
                break
        else:
            rows.append([r])
    return [r for row in rows for r in sorted(row, key=lambda r: -r[2] if rtl else r[0])]


def panel_crops(page: dict, size: tuple[int, int], offset: tuple[float, float], rtl: bool) -> list[tuple[int, int, int, int]]:
    """Each visible panel's box grown to take in the lettering whose centre falls inside it, in reading order,
    in the image's pixels. A page without panels is one crop."""
    W, H = size
    ox, oy = offset
    layers = [l for l in page.get("layers") or [] if l.get("visible", True)]
    panels = []
    for l in layers:
        if l.get("type") == "panel":
            x0, y0, x1, y1 = _bbox(l)
            pad = (l.get("border") or 0) / 2 + 2
            panels.append([x0 - pad, y0 - pad, x1 + pad, y1 + pad])
    if not panels:
        return [(0, 0, W, H)]
    for l in layers:
        if l.get("type") not in LETTERING:
            continue
        b = _bbox(l)
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        home = next((p for p in panels if p[0] <= cx <= p[2] and p[1] <= cy <= p[3]), None)
        if home is None:
            home = min(panels, key=lambda p: (max(p[0] - cx, 0, cx - p[2]) ** 2 + max(p[1] - cy, 0, cy - p[3]) ** 2))
        home[:] = [min(home[0], b[0]), min(home[1], b[1]), max(home[2], b[2]), max(home[3], b[3])]
    out = []
    for x0, y0, x1, y1 in reading_order([tuple(p) for p in panels], rtl):
        box = (max(0, round(x0 - ox)), max(0, round(y0 - oy)), min(W, round(x1 - ox)), min(H, round(y1 - oy)))
        if box[2] - box[0] > 4 and box[3] - box[1] > 4:
            out.append(box)
    return out or [(0, 0, W, H)]


def _page_images(d: Path, doc: dict) -> list[tuple[dict, Image.Image, tuple[float, float]]]:
    """(page, image, canvas offset) per page in reading order. A spread uses spread_NN.png when it was written,
    else its two halves without panel cropping."""
    W = doc.get("width", 1800)
    files = dict(zip((s["n"] for s in slots(doc)), slot_files(d, doc)))
    out = []
    for s in slots(doc):
        p = doc["pages"][s["page"]]
        if s["half"] is None:
            im = Image.open(files[s["n"]]).convert("RGB")
            off = ((W - im.width) / 2, (doc.get("height", 2700) - im.height) / 2)
            out.append((p, im, off))
        elif s["half"] == "first":
            whole = d / f"spread_{s['n']:02d}.png"
            if whole.exists():
                im = Image.open(whole).convert("RGB")
                out.append((p, im, ((2 * W - im.width) / 2 if im.width > W else 0, 0)))
            else:
                out += [({}, Image.open(files[k]).convert("RGB"), (0, 0)) for k in (s["n"], s["n"] + 1)]
    return out


def webtoon(d: Path, doc: dict, width: int = 800, slice_h: int = 1280, gap: int = 80, margin: int = 0,
            fmt: str = "jpg", quality: int = 90, bg: str = "#ffffff") -> list[Path]:
    """Every panel restacked top to bottom in reading order at the strip width, then cut into slices no taller than
    slice_h, preferring cuts in the gaps between panels."""
    rtl = doc.get("reading") != "ltr"
    inner = width - 2 * margin
    tiles, page_breaks = [], []
    for p, im, off in _page_images(d, doc):
        for box in panel_crops(p, im.size, off, rtl):
            crop = im.crop(box)
            s = inner / max(crop.width, im.width * 0.5)
            tiles.append(crop.resize((max(1, round(crop.width * s)), max(1, round(crop.height * s))), Image.LANCZOS))
        page_breaks.append(len(tiles))
    if not tiles:
        raise ExportError("no pages to export")
    total = sum(t.height for t in tiles) + gap * (len(tiles) + 1)
    strip = Image.new("RGB", (width, total), bg)
    y, cuts = gap, []
    for t in tiles:
        strip.paste(t, ((width - t.width) // 2, y))
        y += t.height + gap
        cuts.append(y - gap // 2)
    pieces, top = [], 0
    while top < total:
        limit = top + slice_h
        if limit >= total:
            pieces.append((top, total))
            break
        ok = [c for c in cuts if top + slice_h * 0.5 < c <= limit]
        bottom = ok[-1] if ok else limit
        pieces.append((top, bottom))
        top = bottom
    if len(pieces) > 1 and pieces[-1][0] >= total - gap:
        pieces.pop()
        if total - pieces[-1][0] <= slice_h:
            pieces[-1] = (pieces[-1][0], total)
    out_dir = d / "export" / "webtoon"
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("strip_*.*"):
        old.unlink()
    ext = "png" if fmt == "png" else "jpg"
    files = []
    for i, (a, b) in enumerate(pieces, 1):
        f = out_dir / f"strip_{i:03d}.{ext}"
        piece = strip.crop((0, a, width, b))
        piece.save(f, quality=quality, optimize=True) if ext == "jpg" else piece.save(f, optimize=True)
        files.append(f)
    return files


# ------------------------------------------------------------------------------ CBZ
def comic_info(doc: dict, pages: list[dict]) -> str:
    f = page_format(doc)
    manga = "YesAndRightToLeft" if f["binding"] == "rtl" else "No"
    rows = []
    for i, pg in enumerate(pages):
        attrs = [f'Image="{i}"', f'ImageWidth="{pg["w"]}"', f'ImageHeight="{pg["h"]}"']
        if i == 0:
            attrs.append('Type="FrontCover"')
        if pg.get("double"):
            attrs.append('DoublePage="true"')
        if pg.get("bookmark"):
            attrs.append(f'Bookmark="{escape(pg["bookmark"], {chr(34): "&quot;"})}"')
        rows.append(f"    <Page {' '.join(attrs)} />")
    meta = {"Title": doc.get("title") or "Untitled", "Series": doc.get("series") or doc.get("title") or "Untitled",
            "Number": str(doc.get("number") or 1), "Summary": doc.get("summary") or "", "Writer": doc.get("author") or "",
            "LanguageISO": doc.get("language") or "", "PageCount": str(len(pages)), "Manga": manga,
            "BlackAndWhite": "Yes" if f["colour"] in ("mono", "grey") else "Unknown"}
    body = "\n".join(f"  <{k}>{escape(v)}</{k}>" for k, v in meta.items() if v)
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
            f"{body}\n  <Pages>\n" + "\n".join(rows) + "\n  </Pages>\n</ComicInfo>\n")


def _encode(im: Image.Image, fmt: str, quality: int) -> bytes:
    b = io.BytesIO()
    if fmt == "jpg":
        im.convert("RGB").save(b, "JPEG", quality=quality, optimize=True)
    else:
        im.save(b, "PNG", optimize=False)
    return b.getvalue()


def cbz(d: Path, doc: dict, fmt: str = "png", quality: int = 92) -> Path:
    """Page images plus ComicInfo.xml. A spread goes in as one double-width page when spread_NN.png exists."""
    files = slot_files(d, doc)
    marks = {n: t for t, n in chapters(doc)} if any(p.get("chapter") for p in doc.get("pages") or []) else {}
    entries, info = [], []
    for s, f in zip(slots(doc), files):
        whole = d / f"spread_{s['n']:02d}.png"
        if s["half"] == "second" and (d / f"spread_{s['n'] - 1:02d}.png").exists():
            continue
        src = whole if s["half"] == "first" and whole.exists() else f
        im = Image.open(src)
        ext = "jpg" if fmt == "jpg" else "png"
        entries.append((f"{len(entries) + 1:03d}.{ext}", _encode(im, fmt, quality) if (fmt == "jpg" or src.suffix != ".png") else src.read_bytes()))
        info.append({"w": im.width, "h": im.height, "double": src == whole, "bookmark": marks.get(s["n"])})
    out = d / "export" / f"{d.name}.cbz"
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w") as z:
        for name, data in entries:
            z.writestr(zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0)), data, compress_type=zipfile.ZIP_STORED)
        z.writestr("ComicInfo.xml", comic_info(doc, info), compress_type=zipfile.ZIP_DEFLATED)
    return out


# ------------------------------------------------------------------------------ EPUB
def epub(d: Path, doc: dict, fmt: str = "jpg", quality: int = 90) -> Path:
    """EPUB 3 fixed layout: one XHTML page per slot (spreads as their two halves on facing pages), right to left
    for manga, a table of contents from the chapters and a page list."""
    f = page_format(doc)
    files = slot_files(d, doc)
    title = doc.get("title") or d.name
    lang = doc.get("language") or "en"
    ident = "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, f"mangamaker:{d.name}:{title}"))
    modified = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ext, mime = ("jpg", "image/jpeg") if fmt == "jpg" else ("png", "image/png")
    items, spine, pages_x = [], [], []
    blobs: list[tuple[str, bytes]] = []
    for s, src in zip(slots(doc), files):
        n = s["n"]
        im = Image.open(src)
        img = f"images/p{n:03d}.{ext}"
        blobs.append((f"OEBPS/{img}", _encode(im, fmt, quality) if fmt == "jpg" else src.read_bytes()))
        xhtml = (f'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
                 f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="{lang}" lang="{lang}">\n'
                 f'<head><meta charset="UTF-8"/><title>{escape(title)} {n}</title>'
                 f'<meta name="viewport" content="width={im.width}, height={im.height}"/>'
                 '<style>html,body{margin:0;padding:0;overflow:hidden}img{display:block;width:100%;height:100%}</style></head>\n'
                 f'<body><img src="../{img}" alt="{n}"/></body>\n</html>\n')
        blobs.append((f"OEBPS/pages/p{n:03d}.xhtml", xhtml.encode()))
        cover = ' properties="cover-image"' if n == 1 else ""
        items.append(f'<item id="img{n}" href="{img}" media-type="{mime}"{cover}/>')
        items.append(f'<item id="p{n}" href="pages/p{n:03d}.xhtml" media-type="application/xhtml+xml"/>')
        spine.append(f'<itemref idref="p{n}" properties="page-spread-{spread_side(n, f["binding"])}"/>')
        pages_x.append(f'<li><a href="pages/p{n:03d}.xhtml">{n}</a></li>')
    toc = "".join(f'<li><a href="pages/p{n:03d}.xhtml">{escape(t)}</a></li>' for t, n in chapters(doc))
    nav = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
           f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="{lang}" lang="{lang}">\n'
           f'<head><meta charset="UTF-8"/><title>{escape(title)}</title></head>\n<body>\n'
           f'<nav epub:type="toc" id="toc"><h1>{escape(title)}</h1><ol>{toc}</ol></nav>\n'
           f'<nav epub:type="page-list" hidden=""><ol>{"".join(pages_x)}</ol></nav>\n</body>\n</html>\n')
    w0, h0 = Image.open(files[0]).size
    opf = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" '
           f'prefix="rendition: http://www.idpf.org/vocab/rendition/#" xml:lang="{lang}">\n'
           '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
           f'<dc:identifier id="bookid">{ident}</dc:identifier>\n<dc:title>{escape(title)}</dc:title>\n'
           f'<dc:language>{lang}</dc:language>\n'
           + (f'<dc:creator>{escape(doc["author"])}</dc:creator>\n' if doc.get("author") else "")
           + f'<meta property="dcterms:modified">{modified}</meta>\n'
           '<meta property="rendition:layout">pre-paginated</meta>\n'
           '<meta property="rendition:orientation">auto</meta>\n'
           '<meta property="rendition:spread">landscape</meta>\n'
           '<meta name="cover" content="img1"/>\n'
           f'<meta name="original-resolution" content="{w0}x{h0}"/>\n'
           '</metadata>\n<manifest>\n<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n'
           + "\n".join(items) + "\n</manifest>\n"
           f'<spine page-progression-direction="{"rtl" if f["binding"] == "rtl" else "ltr"}">\n'
           + "\n".join(spine) + "\n</spine>\n</package>\n")
    container = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                 '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
                 '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n'
                 '</container>\n')
    out = d / "export" / f"{d.name}.epub"
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, compress_type=zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/nav.xhtml", nav, compress_type=zipfile.ZIP_DEFLATED)
        for name, data in blobs:
            z.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED if name.endswith(".xhtml") else zipfile.ZIP_STORED)
    return out


# ------------------------------------------------------------------------------ print PDF
def cmyk_profile(explicit: str | None = None) -> Path | None:
    for c in [explicit, os.environ.get("MANGAMAKER_CMYK_PROFILE"), *CMYK_PROFILES]:
        if c and Path(c).expanduser().is_file():
            return Path(c).expanduser()
    return None


def to_cmyk(im: Image.Image, profile: Path | None) -> Image.Image:
    """RGB to CMYK through the ICC profile when there is one, else full grey replacement. Either way neutral
    black and greys print on the K plate only, so text and line art never come out as four-colour black."""
    import numpy as np

    rgb = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    neutral = (np.ptp(rgb, axis=2) < 1.5 / 255)
    if profile is not None:
        from PIL import ImageCms
        srgb = ImageCms.createProfile("sRGB")
        out = np.array(ImageCms.profileToProfile(im.convert("RGB"), srgb, str(profile), outputMode="CMYK",
                                                 renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC))
    else:
        k = 1.0 - rgb.max(axis=2)
        den = np.where(k < 1.0, 1.0 - k, 1.0)
        c, m, y = ((1.0 - rgb[..., i] - k) / den for i in range(3))
        out = (np.stack([c, m, y, k], axis=2) * 255 + 0.5).clip(0, 255).astype(np.uint8)
    grey_k = ((1.0 - rgb[..., 0]) * 255 + 0.5).astype(np.uint8)
    out[neutral] = 0
    out[..., 3][neutral] = grey_k[neutral]
    return Image.fromarray(out, "CMYK")


def _pdf(pages: list[dict], icc: bytes | None, title: str) -> bytes:
    """A minimal PDF: one full-page image per page with MediaBox, BleedBox and TrimBox, and an output intent
    carrying the CMYK profile when there is one."""
    objs: list[bytes] = []

    def add(b: bytes) -> int:
        objs.append(b)
        return len(objs)

    def stream(head: str, data: bytes) -> int:
        return add(f"<< {head} /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream")

    catalog = add(b"")
    tree = add(b"")
    kids = []
    for pg in pages:
        im, wpt, hpt, bleed = pg["image"], pg["w"], pg["h"], pg["bleed"]
        if im.mode == "1":
            cs, bpc = "/DeviceGray", 1
        elif im.mode == "L":
            cs, bpc = "/DeviceGray", 8
        elif im.mode == "CMYK":
            cs, bpc = "/DeviceCMYK", 8
        else:
            im, cs, bpc = im.convert("RGB"), "/DeviceRGB", 8
        xo = stream(f"/Type /XObject /Subtype /Image /Width {im.width} /Height {im.height} /ColorSpace {cs} "
                    f"/BitsPerComponent {bpc} /Filter /FlateDecode", zlib.compress(im.tobytes(), 6))
        content = stream("", f"q {wpt:.3f} 0 0 {hpt:.3f} 0 0 cm /Im0 Do Q".encode())
        trim = f"[{bleed:.3f} {bleed:.3f} {wpt - bleed:.3f} {hpt - bleed:.3f}]"
        kids.append(add((f"<< /Type /Page /Parent {tree} 0 R /MediaBox [0 0 {wpt:.3f} {hpt:.3f}] "
                         f"/BleedBox [0 0 {wpt:.3f} {hpt:.3f}] /TrimBox {trim} "
                         f"/Resources << /XObject << /Im0 {xo} 0 R >> >> /Contents {content} 0 R >>").encode()))
    objs[tree - 1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>".encode()
    intent = ""
    if icc:
        prof = stream("/N 4", icc)
        oi = add(f"<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (CMYK) /Info (CMYK) "
                 f"/DestOutputProfile {prof} 0 R >>".encode())
        intent = f" /OutputIntents [{oi} 0 R]"
    objs[catalog - 1] = f"<< /Type /Catalog /Pages {tree} 0 R{intent} >>".encode()
    info = add(f"<< /Title ({title.translate({40: '_', 41: '_', 92: '_'})}) /Producer (MangaMaker) >>".encode("latin-1", "replace"))
    out = bytearray(b"%PDF-1.6\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, b in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + b + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root {catalog} 0 R /Info {info} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def print_pdf(d: Path, doc: dict, colour: str | None = None, dpi: float | None = None, profile: str | None = None) -> tuple[Path, list[str]]:
    """Print-ready PDF, one page per slot with its bleed, TrimBox and BleedBox. colour: 'colour' (CMYK, K-only
    black), 'grey' (8-bit) or 'mono' (1-bit at 600 dpi or more, dithered). Returns the file and preflight warnings."""
    f = page_format(doc)
    colour = colour or f["colour"]
    files = slot_files(d, doc)
    src_dpi = f["dpi"]
    target = dpi or (max(600.0, src_dpi) if colour == "mono" else src_dpi)
    prof = cmyk_profile(profile) if colour == "colour" else None
    warnings = []
    if src_dpi < 300:
        warnings.append(f"pages are {src_dpi:.0f} dpi at print size; 300+ is needed for sharp print (350 for colour)")
    if colour == "colour" and prof is None:
        warnings.append("no CMYK ICC profile found: used a plain conversion; set MANGAMAKER_CMYK_PROFILE for your printer's profile")
    pages = []
    for s, src in zip(slots(doc), files):
        im = Image.open(src)
        trim_px = (f["trimW"] * src_dpi / MM, f["trimH"] * src_dpi / MM)
        bleed_mm = max(0.0, (im.width - trim_px[0]) / 2 * MM / src_dpi)
        if bleed_mm < 0.5 and f["bleed"] > 0:
            warnings.append(f"page {s['n']}: exported without bleed")
        if abs(target - src_dpi) > 1:
            im = im.resize((round(im.width * target / src_dpi), round(im.height * target / src_dpi)), Image.LANCZOS)
        if colour == "mono":
            im = im.convert("L").convert("1")
        elif colour == "grey":
            im = im.convert("L")
        else:
            im = to_cmyk(im, prof)
        pages.append({"image": im, "w": im.width * 72 / target, "h": im.height * 72 / target, "bleed": bleed_mm * 72 / MM})
    out = d / "export" / f"{d.name}_print.pdf"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(_pdf(pages, prof.read_bytes() if prof else None, doc.get("title") or d.name))
    return out, list(dict.fromkeys(warnings))


# ------------------------------------------------------------------------------ all
def export_book(d: Path, formats: list[str], opts: dict | None = None) -> dict:
    """Runs the asked formats for the project folder d. opts holds per-format options keyed by format name."""
    import json

    opts = opts or {}
    doc = json.loads((d / "project.json").read_text(encoding="utf-8"))
    files, warnings = [], []
    for fmt in formats:
        o = opts.get(fmt) or {}
        if fmt == "webtoon":
            files += webtoon(d, doc, **{k: o[k] for k in ("width", "slice_h", "gap", "margin", "fmt", "quality") if k in o})
        elif fmt == "cbz":
            files.append(cbz(d, doc, **{k: o[k] for k in ("fmt", "quality") if k in o}))
        elif fmt == "epub":
            files.append(epub(d, doc, **{k: o[k] for k in ("fmt", "quality") if k in o}))
        elif fmt == "print":
            p, w = print_pdf(d, doc, **{k: o[k] for k in ("colour", "dpi", "profile") if k in o})
            files.append(p)
            warnings += w
        else:
            raise ExportError(f"unknown export format {fmt!r}")
    return {"files": [str(p) for p in files], "warnings": warnings}
