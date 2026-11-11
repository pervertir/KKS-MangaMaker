"""Put the base models and the curated Civitai LoRAs from docker/models.yaml onto the network volume.

Runs at pod start (docker/bootstrap.sh) and is safe to re-run: files already present are skipped.
Civitai needs CIVITAI_API_KEY in the pod's environment (a RunPod secret); without it the LoRAs are
skipped and the base models still download. Every LoRA is re-checked against mp.civitai.BLOCKLIST
before download. Trigger words go to <home>/cache/loras/<file>.json, the same place and format
mp/civitai.py uses, and characters are registered in <home>/cache/lora_index.json so
`lora: auto` in a shot picks the bundled (adult) version.

    python3 fetch_models.py --comfy /workspace/runpod-slim/ComfyUI --home /workspace/MangaPipeline [--sets all] [--check]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from mp.civitai import API, UA, _slug, blocked  # noqa: E402

# Registered as `name|series` for each of these series too, so "series: Naruto" also lands on the adult file.
SERIES_ALIASES = ["", "naruto", "boruto", "naruto shippuden", "boruto naruto next generations"]


def log(msg: str):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def is_safetensors(p: Path) -> bool:
    with open(p, "rb") as fh:
        head = fh.read(16)
    return len(head) >= 9 and head[8:9] == b"{"


def fetch_base(comfy: Path, items: list[dict], key: str | None) -> None:
    for it in items:
        dest = comfy / "models" / it["dir"] / it["file"]
        if dest.exists() and dest.stat().st_size > 1_000_000:
            log(f"have  {it['file']}")
            continue
        if it.get("civitai") and not key:
            log(f"skip  {it['file']}: Civitai file, needs CIVITAI_API_KEY")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        log(f"get   {it['file']}")
        part = dest.with_name(dest.name + ".part")
        # The key goes in on stdin (curl -K -), never on the command line where ps would show it.
        auth = f'header = "Authorization: Bearer {key}"\n' if it.get("civitai") else ""
        r = subprocess.run(["curl", "-K", "-", "-L", "--fail", "--retry", "3", "--retry-delay", "5", "-sS", "-o", str(part), it["url"]],
                           input=auth, text=True)
        if r.returncode != 0:
            log(f"FAILED {it['file']} (curl exit {r.returncode})")
            part.unlink(missing_ok=True)
            continue
        part.rename(dest)


class Civ:
    def __init__(self, key: str | None):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        if key:
            self.s.headers["Authorization"] = f"Bearer {key}"

    def get(self, path: str) -> dict:
        for attempt in range(4):
            r = self.s.get(f"{API}/{path}", timeout=60)
            if r.status_code == 429:
                time.sleep(3 + attempt * 5)
                continue
            r.raise_for_status()
            return r.json()
        raise RuntimeError("Civitai rate-limited four times")


def fetch_loras(comfy: Path, home: Path, cfg: dict, sets: list[str], key: str | None, check: bool) -> list[str]:
    civ = Civ(key)
    meta_dir = home / "cache" / "loras"
    index_path = home / "cache" / "lora_index.json"
    if not check:
        meta_dir.mkdir(parents=True, exist_ok=True)
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    extra_block = cfg.get("blocklist", [])
    problems = []

    for set_name, group in cfg.get("lora_sets", {}).items():
        if "all" not in sets and set_name not in sets:
            continue
        subdir = group.get("subdir", "civitai_characters")
        for it in group.get("items", []):
            label = it.get("character") or it.get("concept") or str(it["model"])
            try:
                model = civ.get(f"models/{it['model']}")
            except Exception as e:
                problems.append(f"{label}: metadata failed ({e})")
                log(f"skip  {label}: metadata failed ({e})")
                continue
            v = next((x for x in model.get("modelVersions", []) if x["id"] == it["version"]), None)
            if v is None:
                problems.append(f"{label}: version {it['version']} not on model {it['model']}")
                log(f"skip  {label}: version {it['version']} not found")
                continue
            hit = blocked([model.get("name", ""), v.get("name", ""), *model.get("tags", []), *v.get("trainedWords", [])], extra_block)
            if hit:
                problems.append(f"{label}: refused by blocklist ({hit}) - {model.get('name')}")
                log(f"REFUSE {label}: blocklist '{hit}' ({model.get('name')})")
                continue
            files = [f for f in v.get("files", []) if f.get("name", "").endswith(".safetensors")]
            if not files:
                problems.append(f"{label}: no safetensors file")
                continue
            f = next((x for x in files if x.get("primary")), files[0])
            fname = _slug(Path(f["name"]).stem) + ".safetensors"
            comfy_name = f"{subdir}/{fname}"
            dest = comfy / "models" / "loras" / subdir / fname
            words = v.get("trainedWords", [])
            if check:
                log(f"ok    {label:28s} {v.get('baseModel'):12s} {fname}  [{', '.join(w[:40] for w in words[:2])}]")
                continue
            if not (dest.exists() and dest.stat().st_size > 100_000):
                if not key:
                    log(f"skip  {label}: CIVITAI_API_KEY not set")
                    problems.append(f"{label}: no CIVITAI_API_KEY")
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                part = dest.with_name(dest.name + ".part")
                url = f.get("downloadUrl") or f"{API}/download/models/{v['id']}"
                log(f"get   {label} -> {comfy_name} ({f.get('sizeKB', 0) / 1024:.0f} MB)")
                try:
                    with civ.s.get(url, stream=True, timeout=120, allow_redirects=True) as r:
                        if r.status_code in (401, 403):
                            raise RuntimeError("Civitai refused the download (check CIVITAI_API_KEY)")
                        r.raise_for_status()
                        with open(part, "wb") as out:
                            for chunk in r.iter_content(1 << 20):
                                out.write(chunk)
                    if not is_safetensors(part):
                        raise RuntimeError("not a safetensors file (login or consent page?)")
                    part.rename(dest)
                except Exception as e:
                    part.unlink(missing_ok=True)
                    problems.append(f"{label}: download failed ({e})")
                    log(f"FAILED {label}: {e}")
                    continue
            else:
                log(f"have  {comfy_name}")
            (meta_dir / f"{fname}.json").write_text(json.dumps({
                "modelId": model["id"], "modelName": model.get("name"),
                "versionId": v["id"], "versionName": v.get("name"),
                "baseModel": v.get("baseModel"), "trainedWords": words,
                "url": f"https://civitai.com/models/{model['id']}?modelVersionId={v['id']}",
                "bundled": set_name, "concept": it.get("concept"),
            }, indent=2))
            if it.get("character") and it.get("register", True):
                name = it["character"].strip().lower()
                for series in {it.get("series", "").strip().lower(), *SERIES_ALIASES}:
                    index[f"{name}|{series}"] = {"lora": comfy_name, "modelId": model["id"], "checked": time.time(), "bundled": True}
    if not check:
        index_path.write_text(json.dumps(index, indent=2))
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--comfy", default="/workspace/runpod-slim/ComfyUI")
    ap.add_argument("--home", default=os.environ.get("MANGA_HOME", "/workspace/MangaPipeline"))
    ap.add_argument("--manifest", default=str(HERE / "models.yaml"))
    ap.add_argument("--sets", default="all", help="comma list of lora_sets keys, 'all', or 'none'")
    ap.add_argument("--no-base", action="store_true", help="skip the checkpoint/ControlNet/IPAdapter downloads")
    ap.add_argument("--check", action="store_true", help="only verify the manifest against Civitai (no downloads)")
    a = ap.parse_args()

    cfg = yaml.safe_load(open(a.manifest, encoding="utf-8"))
    comfy, home = Path(a.comfy), Path(a.home)
    key = next((os.environ[k].strip() for k in ("CIVITAI_API_KEY", "CAI_API_KEY", "CIVIT_AI_KEY") if os.environ.get(k)), None)
    if not a.check and not a.no_base:
        fetch_base(comfy, cfg.get("base", []), key)
    sets = [s.strip() for s in a.sets.split(",") if s.strip()]
    problems = [] if "none" in sets else fetch_loras(comfy, home, cfg, sets, key, a.check)
    log("done" + (f", {len(problems)} problem(s):" if problems else ""))
    for p in problems:
        log("  - " + p)
    return 1 if a.check and problems else 0


if __name__ == "__main__":
    sys.exit(main())
