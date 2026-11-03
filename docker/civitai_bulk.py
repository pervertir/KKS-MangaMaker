"""Bulk Civitai downloader for the pod: URLs or ids in, files in the right ComfyUI models folder out.

    civitai-dl https://civitai.com/models/123?modelVersionId=456 789 ...
    civitai-dl -f /workspace/MangaPipeline/civitai.txt      # one URL or id per line, # comments
    CIVITAI_BULK_FILE=... at pod start runs it in the background (docker/bootstrap.sh)

The folder comes from the model type (Checkpoint, LORA/LoCon/DoRA, Controlnet, TextualInversion,
VAE, Upscaler). Needs CIVITAI_API_KEY. Every model is checked against mp.civitai.BLOCKLIST first,
so minors, child-era versions and loli/shota styles are refused. Existing files are skipped.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from fetch_models import Civ, is_safetensors, log  # noqa: E402
from mp.civitai import API, _slug, blocked  # noqa: E402

TYPE_DIRS = {"checkpoint": "checkpoints", "lora": "loras/civitai", "locon": "loras/civitai", "dora": "loras/civitai",
             "controlnet": "controlnet", "textualinversion": "embeddings", "vae": "vae", "upscaler": "upscale_models"}


def parse(ref: str) -> tuple[int, int | None] | None:
    ref = ref.strip()
    m = re.search(r"civitai\.com/models/(\d+)(?:.*?modelVersionId=(\d+))?", ref)
    if m:
        return int(m.group(1)), int(m.group(2)) if m.group(2) else None
    return (int(ref), None) if ref.isdigit() else None


def one(civ: Civ, comfy: Path, home: Path, ref: str) -> str:
    p = parse(ref)
    if not p:
        return f"skip  {ref}: not a Civitai model URL or id"
    model = civ.get(f"models/{p[0]}")
    versions = model.get("modelVersions", [])
    v = next((x for x in versions if x["id"] == p[1]), None) if p[1] else (versions[0] if versions else None)
    if v is None:
        return f"skip  {ref}: version not found"
    hit = blocked([model.get("name", ""), v.get("name", ""), *model.get("tags", []), *v.get("trainedWords", [])])
    if hit:
        return f"REFUSE {model.get('name')}: blocklist '{hit}'"
    sub = TYPE_DIRS.get((model.get("type") or "").lower())
    if not sub:
        return f"skip  {model.get('name')}: type {model.get('type')} has no models folder here"
    files = [f for f in v.get("files", []) if f.get("name", "").endswith((".safetensors", ".pt", ".pth", ".bin"))]
    if not files:
        return f"skip  {model.get('name')}: no model file"
    f = next((x for x in files if x.get("primary")), files[0])
    stem, ext = os.path.splitext(f["name"])
    dest = comfy / "models" / sub / (_slug(stem) + ext)
    if dest.exists() and dest.stat().st_size > 100_000:
        return f"have  {sub}/{dest.name}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    try:
        with civ.s.get(f.get("downloadUrl") or f"{API}/download/models/{v['id']}", stream=True, timeout=120) as r:
            if r.status_code in (401, 403):
                raise RuntimeError("refused (check CIVITAI_API_KEY)")
            r.raise_for_status()
            with open(part, "wb") as out:
                for chunk in r.iter_content(1 << 20):
                    out.write(chunk)
        if ext == ".safetensors" and not is_safetensors(part):
            raise RuntimeError("not a safetensors file (login or consent page?)")
        part.rename(dest)
    except Exception as e:
        part.unlink(missing_ok=True)
        return f"FAILED {model.get('name')}: {e}"
    if sub.startswith("loras"):
        meta = home / "cache" / "loras"
        meta.mkdir(parents=True, exist_ok=True)
        (meta / f"{dest.name}.json").write_text(json.dumps({
            "modelId": model["id"], "modelName": model.get("name"), "versionId": v["id"], "versionName": v.get("name"),
            "baseModel": v.get("baseModel"), "trainedWords": v.get("trainedWords", []),
            "url": f"https://civitai.com/models/{model['id']}?modelVersionId={v['id']}"}, indent=2))
    return f"got   {sub}/{dest.name} ({f.get('sizeKB', 0) / 1024:.0f} MB)"


def safe(civ: Civ, comfy: Path, home: Path, ref: str) -> str:
    try:
        return one(civ, comfy, home, ref)
    except Exception as e:
        return f"FAILED {ref}: {e}"


def main():
    ap = argparse.ArgumentParser(description="Bulk-download Civitai models into ComfyUI's models folders")
    ap.add_argument("refs", nargs="*", help="Civitai model URLs (optionally with modelVersionId) or model ids")
    ap.add_argument("-f", "--file", help="text file with one URL or id per line")
    ap.add_argument("-j", "--jobs", type=int, default=3)
    ap.add_argument("--comfy", default="/workspace/runpod-slim/ComfyUI")
    ap.add_argument("--home", default=os.environ.get("MANGA_HOME", "/workspace/MangaPipeline"))
    a = ap.parse_args()
    refs = list(a.refs)
    if a.file:
        refs += [l.split("#")[0].strip() for l in open(a.file, encoding="utf-8")]
    refs = [r for r in refs if r]
    key = next((os.environ[k].strip() for k in ("CIVITAI_API_KEY", "CAI_API_KEY") if os.environ.get(k)), None)
    if not key:
        log("CIVITAI_API_KEY is not set; Civitai refuses most downloads without it")
    civ = Civ(key)
    with ThreadPoolExecutor(max(1, a.jobs)) as ex:
        for line in ex.map(lambda r: safe(civ, Path(a.comfy), Path(a.home), r), refs):
            log(line)


if __name__ == "__main__":
    main()
