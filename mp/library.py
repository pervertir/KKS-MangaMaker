"""The asset library: backgrounds, props, expressions and saved layer groups, reused across projects.

    assets/library/index.json     {"version": 1, "seeded": [ids], "assets": [asset, ...]}
    assets/library/blobs/<sha256>.<ext>

An asset is {id, kind, name, tags, character, thumb, payload, source, created}. payload is one of
    {"type": "image", "ref", "w", "h", "multiply"}       placed as an image layer, or into a panel
    {"type": "bubble", "key"}                             a speech-bubble template
    {"type": "layers", "layers": [...], "w", "h"}         editor layers, positions relative to (0, 0)
Images saved into the library are copied into blobs/ by content hash (ref "lib:<sha>.<ext>") and blobs
are never rewritten or removed, so a project that placed an asset still opens after the entry is
edited or deleted. Template-pack images are large and fixed, so they are referenced where they are.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Callable

KINDS = ("background", "prop", "expression", "tone", "balloon", "effect", "sfx", "group")
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".svg")
EDITABLE = ("name", "tags", "kind", "character")


class LibraryError(ValueError):
    pass


def words(*parts: str) -> list[str]:
    """Search tags from folder and file names: 'Speed-Lines_03' -> ['speed', 'lines']."""
    out: list[str] = []
    for p in parts:
        for w in re.split(r"[^A-Za-z]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", p)):
            w = w.lower()
            if len(w) > 2 and w not in out and w not in ("images", "png", "jpg"):
                out.append(w)
    return out


def clean_tags(tags) -> list[str]:
    if isinstance(tags, str):
        tags = tags.split(",")
    out: list[str] = []
    for t in tags or []:
        t = re.sub(r"\s+", " ", str(t)).strip().lower()[:40]
        if t and t not in out:
            out.append(t)
    return out[:32]


class Library:
    def __init__(self, root: Path, resolve: Callable[[str], Path]):
        """resolve: the server's image-ref resolver, used to copy a placed image into the library."""
        self.root = root
        self.blobs = root / "blobs"
        self.index = root / "index.json"
        self.resolve = resolve
        self.lock = threading.RLock()

    # ------------------------------------------------------------------ storage
    def _load(self) -> dict:
        if self.index.exists():
            data = json.loads(self.index.read_text(encoding="utf-8"))
            data.setdefault("assets", [])
            data.setdefault("seeded", [])
            return data
        return {"version": 1, "seeded": [], "assets": []}

    def _save(self, data: dict) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.index.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.index)

    def blob_path(self, rel: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{64}\.[a-z]{3,4}", rel):
            raise LibraryError(f"bad library ref {rel!r}")
        p = self.blobs / rel
        if not p.is_file():
            raise FileNotFoundError("lib:" + rel)
        return p

    def put_blob(self, data: bytes, ext: str) -> str:
        ext = ext.lower().lstrip(".")
        ext = "jpg" if ext == "jpeg" else ext
        if "." + ext not in IMAGE_EXT:
            raise LibraryError("png, jpg, webp or svg only")
        name = f"{hashlib.sha256(data).hexdigest()}.{ext}"
        self.blobs.mkdir(parents=True, exist_ok=True)
        dest = self.blobs / name
        if not dest.exists():
            tmp = dest.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(dest)
        return "lib:" + name

    def keep(self, ref: str) -> str:
        """A ref the library can rely on: template and library images as they are, anything else copied in."""
        if ref.startswith(("lib:", "tpl:")):
            self.resolve(ref)
            return ref
        p = self.resolve(ref)
        return self.put_blob(p.read_bytes(), p.suffix)

    # ------------------------------------------------------------------- reading
    def all(self) -> list[dict]:
        with self.lock:
            return self._load()["assets"]

    def get(self, aid: str) -> dict:
        a = next((a for a in self.all() if a["id"] == aid), None)
        if not a:
            raise FileNotFoundError(f"no asset {aid}")
        return a

    def characters(self) -> list[str]:
        return sorted({a["character"] for a in self.all() if a.get("character")}, key=str.lower)

    # ------------------------------------------------------------------- writing
    def _entry(self, kind: str, name: str, tags, payload: dict, thumb: str | None, character: str = "",
               source: dict | None = None, aid: str | None = None) -> dict:
        if kind not in KINDS:
            raise LibraryError(f"kind must be one of {', '.join(KINDS)}")
        name = re.sub(r"\s+", " ", str(name or "")).strip()[:80] or kind.title()
        return {"id": aid or uuid.uuid4().hex[:12], "kind": kind, "name": name, "tags": clean_tags(tags),
                "character": str(character or "").strip()[:80], "thumb": thumb, "payload": payload,
                "source": source or {}, "created": int(time.time())}

    def _insert(self, entry: dict) -> dict:
        with self.lock:
            data = self._load()
            data["assets"].insert(0, entry)
            self._save(data)
        return entry

    def add_image(self, kind: str, name: str, ref: str, w: int, h: int, tags=(), character: str = "",
                  multiply: bool = False, source: dict | None = None) -> dict:
        ref = self.keep(ref)
        payload = {"type": "image", "ref": ref, "w": int(w), "h": int(h), "multiply": bool(multiply)}
        return self._insert(self._entry(kind, name, tags, payload, ref, character, source))

    def add_layers(self, kind: str, name: str, layers: list[dict], thumb_png: bytes | None, tags=(),
                   character: str = "", source: dict | None = None) -> dict:
        if not layers:
            raise LibraryError("nothing to save")
        layers = json.loads(json.dumps(layers))
        x0 = min(float(l.get("x", 0)) for l in layers)
        y0 = min(float(l.get("y", 0)) for l in layers)
        x1 = max(float(l.get("x", 0)) + float(l.get("w", 0)) for l in layers)
        y1 = max(float(l.get("y", 0)) + float(l.get("h", 0)) for l in layers)
        for l in layers:
            l["x"] = float(l.get("x", 0)) - x0
            l["y"] = float(l.get("y", 0)) - y0
            if isinstance(l.get("ref"), str):
                l["ref"] = self.keep(l["ref"])
            if isinstance(l.get("image"), dict) and isinstance(l["image"].get("ref"), str):
                l["image"]["ref"] = self.keep(l["image"]["ref"])
        thumb = self.put_blob(thumb_png, "png") if thumb_png else None
        payload = {"type": "layers", "layers": layers, "w": round(x1 - x0, 2), "h": round(y1 - y0, 2)}
        return self._insert(self._entry(kind, name, tags, payload, thumb, character, source))

    def update(self, aid: str, fields: dict) -> dict:
        with self.lock:
            data = self._load()
            a = next((a for a in data["assets"] if a["id"] == aid), None)
            if not a:
                raise FileNotFoundError(f"no asset {aid}")
            for k in EDITABLE:
                if k not in fields:
                    continue
                v = fields[k]
                if k == "kind" and v not in KINDS:
                    raise LibraryError(f"kind must be one of {', '.join(KINDS)}")
                a[k] = clean_tags(v) if k == "tags" else str(v or "").strip()[:80]
            self._save(data)
            return a

    def remove(self, aid: str) -> None:
        """Drops the entry; its blobs stay, because placed copies may still point at them."""
        with self.lock:
            data = self._load()
            n = len(data["assets"])
            data["assets"] = [a for a in data["assets"] if a["id"] != aid]
            if len(data["assets"]) == n:
                raise FileNotFoundError(f"no asset {aid}")
            self._save(data)

    def seed(self, entries: list[dict]) -> int:
        """Adds each built-in entry (it carries a stable id) once. An entry the user deleted stays deleted."""
        with self.lock:
            data = self._load()
            seen = set(data["seeded"])
            added = 0
            for e in entries:
                if e["id"] in seen:
                    continue
                pay = dict(e["payload"])
                try:
                    if pay.get("type") == "image":
                        pay["ref"] = self.keep(pay["ref"])
                    thumb = pay["ref"] if pay.get("type") == "image" else e.get("thumb") and self.keep(e["thumb"])
                except (OSError, ValueError):
                    continue
                data["assets"].append(self._entry(e["kind"], e["name"], e.get("tags", ()), pay, thumb,
                                                  e.get("character", ""), e.get("source"), e["id"]))
                data["seeded"].append(e["id"])
                seen.add(e["id"])
                added += 1
            if added:
                self._save(data)
            return added
