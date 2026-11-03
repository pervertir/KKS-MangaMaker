"""`civitai-dl` on the pod: screens a list against the content blocklist, then hands it to the
user's civitai-bulk-downloader (https://github.com/deepratna-awale/civitai-bulk-downloader, baked
into the image at /opt/civitai-bulk-downloader) with the ComfyUI folder layout.

    civitai-dl https://civitai.com/models/123?modelVersionId=456 789 ...
    civitai-dl -f /workspace/MangaPipeline/civitai.txt      # one URL or id per line, # comments
    civitai-dl ... -- --verify --connections 8               # anything after -- goes to civitai-download

Each entry is looked up on the Civitai API first and refused if its name, tags or trigger words hit
mp.civitai.BLOCKLIST (minors, child-era versions, loli/shota styles). Entries that are not a Civitai
URL or id (e.g. bare model names) and entries whose lookup fails are refused too: nothing goes
through unchecked. LoRA trigger words are saved for the pipeline. Needs CIVITAI_API_KEY.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from fetch_models import Civ, log  # noqa: E402
from mp.civitai import blocked  # noqa: E402

def parse(ref: str) -> tuple[int, int | None] | None:
    ref = ref.strip()
    m = re.search(r"civitai\.(?:com|red|green)/models/(\d+)(?:.*?modelVersionId=(\d+))?", ref)
    if m:
        return int(m.group(1)), int(m.group(2)) if m.group(2) else None
    m = re.search(r"civitai\.(?:com|red|green)/api/download/models/(\d+)", ref)
    if m:
        return None, int(m.group(1))
    return (int(ref), None) if ref.isdigit() else None


def screen(civ: Civ, home: Path, ref: str) -> tuple[bool, str]:
    """(allowed, message). Fails closed."""
    try:
        p = parse(ref)
        if not p:
            return False, f"REFUSE {ref}: only Civitai URLs or model ids can be screened"
        model_id, version_id = p
        if model_id is None:
            model_id = civ.get(f"model-versions/{version_id}")["modelId"]
        model = civ.get(f"models/{model_id}")
        versions = model.get("modelVersions", [])
        v = next((x for x in versions if x["id"] == version_id), None) if version_id else (versions[0] if versions else None)
        if v is None:
            return False, f"REFUSE {ref}: version not found"
        hit = blocked([model.get("name", ""), v.get("name", ""), *model.get("tags", []), *v.get("trainedWords", [])])
        if hit:
            return False, f"REFUSE {model.get('name')}: blocklist '{hit}'"
        if (model.get("type") or "").lower() in ("lora", "locon", "dora"):
            meta = home / "cache" / "loras"
            meta.mkdir(parents=True, exist_ok=True)
            for f in v.get("files", []):
                if f.get("name", "").endswith(".safetensors"):
                    (meta / f"{f['name']}.json").write_text(json.dumps({
                        "modelId": model["id"], "modelName": model.get("name"), "versionId": v["id"],
                        "versionName": v.get("name"), "baseModel": v.get("baseModel"),
                        "trainedWords": v.get("trainedWords", []),
                        "url": f"https://civitai.com/models/{model['id']}?modelVersionId={v['id']}"}, indent=2))
        return True, f"ok    {model.get('name')} / {v.get('name')} [{model.get('type')}]"
    except Exception as e:
        return False, f"REFUSE {ref}: lookup failed ({e})"


def main():
    ap = argparse.ArgumentParser(description="Bulk-download Civitai models into ComfyUI's models folders")
    ap.add_argument("refs", nargs="*", help="Civitai model URLs (optionally with modelVersionId) or model ids")
    ap.add_argument("-f", "--file", help="text file with one URL or id per line")
    ap.add_argument("-j", "--jobs", type=int, default=4, help="parallel API lookups while screening")
    ap.add_argument("--comfy", default="/workspace/runpod-slim/ComfyUI")
    ap.add_argument("--home", default=os.environ.get("MANGA_HOME", "/workspace/MangaPipeline"))
    argv = sys.argv[1:]
    extra = argv[argv.index("--") + 1:] if "--" in argv else []
    a = ap.parse_args(argv[:argv.index("--")] if "--" in argv else argv)
    a.extra = extra
    refs = list(a.refs)
    if a.file:
        refs += [l.split("#")[0].strip() for l in open(a.file, encoding="utf-8")]
    refs = [r for r in refs if r]
    key = next((os.environ[k].strip() for k in ("CIVITAI_API_KEY", "CAI_API_KEY") if os.environ.get(k)), None)
    if not key:
        log("CIVITAI_API_KEY is not set; Civitai refuses most downloads without it")
    civ = Civ(key)
    home = Path(a.home)
    with ThreadPoolExecutor(max(1, a.jobs)) as ex:
        results = list(ex.map(lambda r: screen(civ, home, r), refs))
    allowed = [r for r, (ok, _) in zip(refs, results) if ok]
    for _, (ok, msg) in zip(refs, results):
        log(msg)
    if not allowed:
        log("nothing to download")
        return 1 if refs else 0
    work = home / "civitai-dl"  # the downloader keeps config.json and downloads.log in its cwd
    work.mkdir(parents=True, exist_ok=True)
    lst = work / "approved.txt"
    lst.write_text("\n".join(allowed) + "\n")
    cmd = [sys.executable, "-m", "civitai_downloader", "--ui", "comfyui", "--sd", a.comfy, "--url-file", str(lst), *a.extra]
    if key:  # the downloader takes the variable's name and reads the key itself
        cmd += ["--api-key", "CIVITAI_API_KEY" if os.environ.get("CIVITAI_API_KEY") else "CAI_API_KEY"]
    log(f"downloading {len(allowed)} of {len(refs)} with civitai-bulk-downloader")
    return subprocess.call(cmd, cwd=work, stdin=subprocess.DEVNULL)  # never wait on its key prompt


if __name__ == "__main__":
    sys.exit(main())
