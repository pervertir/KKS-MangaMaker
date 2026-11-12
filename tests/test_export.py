import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mp import export  # noqa: E402

W, H = 1800, 2700


def panel(x, y, w, h):
    return {"type": "panel", "x": x, "y": y, "w": w, "h": h, "visible": True}


def make_project(tmp: Path, pages: list[dict], **doc) -> Path:
    d = tmp / "book"
    d.mkdir()
    full = {"version": 1, "title": "Test Book", "reading": "rtl", "width": W, "height": H, "pages": pages, **doc}
    (d / "project.json").write_text(json.dumps(full))
    n = 1
    for p in pages:
        for _ in range(2 if p.get("span") == 2 else 1):
            im = Image.new("RGB", (W, H), "white")
            g = ImageDraw.Draw(im)
            for i, l in enumerate(x for x in p.get("layers", []) if x["type"] == "panel"):
                g.rectangle([l["x"], l["y"], l["x"] + l["w"], l["y"] + l["h"]], fill=(40 * i, 0, 0), outline="black", width=6)
            g.rectangle([100, 100, 300, 300], fill="black")
            im.save(d / f"page_{n:02d}.png")
            n += 1
    return d


@pytest.fixture
def book(tmp_path):
    two_rows = [panel(80, 80, 1640, 1200), panel(920, 1340, 800, 1280), panel(80, 1340, 800, 1280),
                {"type": "bubble", "x": 950, "y": 1250, "w": 200, "h": 300, "visible": True}]
    return make_project(tmp_path, [{"layers": two_rows, "chapter": "Chapter 1"}, {"layers": []},
                                   {"layers": two_rows[:1], "chapter": "Chapter 2"}])


def test_format_defaults_match_v1_guides():
    f = export.page_format({"width": 1800, "height": 2700})
    assert f["bleed"] == 3.0 and round(f["dpi"]) == 251
    assert round(f["trimW"]) == 176 and f["binding"] == "rtl"


def test_slots_and_sides():
    doc = {"pages": [{}, {"span": 2}, {}]}
    assert [(s["n"], s["half"]) for s in export.slots(doc)] == [(1, None), (2, "first"), (3, "second"), (4, None)]
    assert export.spread_side(1, "rtl") == "left" and export.spread_side(2, "rtl") == "right"
    assert export.spread_side(1, "ltr") == "right"


def test_reading_order_rtl():
    a, b, c = (0, 0, 100, 100), (110, 0, 210, 100), (0, 120, 210, 220)
    assert export.reading_order([a, b, c], True) == [b, a, c]
    assert export.reading_order([a, b, c], False) == [a, b, c]


def test_panel_crops_take_in_lettering(book):
    doc = json.loads((book / "project.json").read_text())
    crops = export.panel_crops(doc["pages"][0], (W, H), (0, 0), True)
    assert crops[0] == (78, 78, 1722, 1282)
    assert crops[1][1] == 1250, "the bubble overlapping the top edge grows the right-hand panel"
    assert crops[1][0] == 918 and crops[2][0] == 78


def test_webtoon_slices(book):
    doc = json.loads((book / "project.json").read_text())
    files = export.webtoon(book, doc, width=800, slice_h=1280)
    assert files and all(Image.open(f).width == 800 for f in files)
    assert all(Image.open(f).height <= 1280 for f in files)
    assert sum(Image.open(f).height for f in files) > 4 * 800
    assert Image.open(files[-1]).height > 80, "no slice of nothing but the trailing gap"


def test_cbz(book):
    doc = json.loads((book / "project.json").read_text())
    out = export.cbz(book, doc)
    with zipfile.ZipFile(out) as z:
        names = z.namelist()
        info = z.read("ComicInfo.xml").decode()
    assert names[:3] == ["001.png", "002.png", "003.png"]
    assert "<Manga>YesAndRightToLeft</Manga>" in info and "<PageCount>3</PageCount>" in info
    assert 'Type="FrontCover"' in info and 'Bookmark="Chapter 2"' in info


def test_epub_structure(book):
    doc = json.loads((book / "project.json").read_text())
    out = export.epub(book, doc)
    with zipfile.ZipFile(out) as z:
        assert z.namelist()[0] == "mimetype" and z.getinfo("mimetype").compress_type == zipfile.ZIP_STORED
        opf = z.read("OEBPS/content.opf").decode()
        nav = z.read("OEBPS/nav.xhtml").decode()
    assert 'page-progression-direction="rtl"' in opf and "pre-paginated" in opf
    assert re.findall(r"page-spread-(\w+)", opf) == ["left", "right", "left"]
    assert "Chapter 1" in nav and "Chapter 2" in nav


EPUBCHECK = shutil.which("epubcheck") or next(iter(Path("/tmp").glob("**/epubcheck.jar")), None)


@pytest.mark.skipif(not EPUBCHECK or not shutil.which("java"), reason="epubcheck not installed")
def test_epub_passes_epubcheck(book):
    doc = json.loads((book / "project.json").read_text())
    out = export.epub(book, doc)
    cmd = [str(EPUBCHECK)] if str(EPUBCHECK).endswith("epubcheck") else ["java", "-jar", str(EPUBCHECK)]
    r = subprocess.run(cmd + [str(out)], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


@pytest.mark.parametrize("colour,mode", [("colour", "/DeviceCMYK"), ("grey", "/DeviceGray"), ("mono", "/BitsPerComponent 1")])
def test_print_pdf_boxes(book, colour, mode):
    doc = json.loads((book / "project.json").read_text())
    out, warnings = export.print_pdf(book, doc, colour=colour)
    raw = out.read_bytes()
    assert raw.count(b"/Type /Page ") == 3 and b"/TrimBox" in raw and b"/BleedBox" in raw
    assert mode.encode() in raw
    assert any("dpi" in w for w in warnings)
    pypdf = pytest.importorskip("pypdf")
    page = pypdf.PdfReader(out).pages[0]
    mm = lambda pt: float(pt) * 25.4 / 72  # noqa: E731
    assert round(mm(page.trimbox.width)) == 176 and round(mm(page.mediabox.width)) == 182


def test_cmyk_black_is_k_only():
    im = Image.new("RGB", (4, 1))
    im.putdata([(0, 0, 0), (128, 128, 128), (255, 255, 255), (255, 0, 0)])
    out = export.to_cmyk(im, None)
    px = [out.getpixel((x, 0)) for x in range(4)]
    assert px[0] == (0, 0, 0, 255) and px[1][:3] == (0, 0, 0) and px[2] == (0, 0, 0, 0)
    assert px[3][1] > 200 and px[3][3] == 0


def test_spread_slots_need_both_halves(tmp_path):
    d = make_project(tmp_path, [{"layers": []}, {"span": 2, "layers": []}, {"layers": []}])
    doc = json.loads((d / "project.json").read_text())
    assert len(export.slot_files(d, doc)) == 4
    Image.new("RGB", (2 * W - 70, H), "white").save(d / "spread_02.png")
    with zipfile.ZipFile(export.cbz(d, doc)) as z:
        info = z.read("ComicInfo.xml").decode()
    assert info.count("<Page ") == 3 and 'DoublePage="true"' in info


def test_missing_pages_are_reported(tmp_path):
    d = make_project(tmp_path, [{"layers": []}])
    (d / "page_01.png").unlink()
    with pytest.raises(export.ExportError, match="page_01"):
        export.export_book(d, ["cbz"])
