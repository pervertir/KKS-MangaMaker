"""Civitai public API: find a character LoRA, put it in the target ComfyUI's loras folder, remember triggers.

The LoRA lands wherever ComfyUI runs: on the RunPod pod (curl over ssh) when `target: runpod`,
or in the local models/loras when `target: local`. Trigger words and provenance are kept in
MangaPipeline/cache/loras/<file>.json either way.
"""
from __future__ import annotations

import json
import math
import re
import time
from pathlib import Path

import requests

API = "https://civitai.com/api/v1"
UA = "MangaPipeline/1.0 (+local script)"


def _tokens(s: str) -> list[str]:
    s = s.lower().replace("_", " ")
    return [t for t in re.split(r"[^a-z0-9]+", s) if len(t) > 1]


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")[:80]


# LoRAs whose name, tags, version name or trigger words contain any of these (whole words) are never
# picked or downloaded: no minors, child-era versions, or young-looking styles. Child characters of
# the series this project uses are listed by name. config.yaml `lora_blocklist` adds more.
BLOCKLIST = [
    "loli", "lolicon", "shota", "shotacon", "child", "children", "kid", "kids", "toddler", "underage",
    "minor", "preteen", "teen", "teenager", "young girl", "young boy", "little girl", "little boy",
    "genin", "academy", "elementary school", "middle school", "daughter", "age regression", "aged down",
    "younger", "boruto uzumaki", "sarada", "himawari", "mitsuki", "kawaki", "chocho", "inojin",
    "shikadai", "hanabi",
]


def blocked(texts, extra=()) -> str | None:
    """First blocklist phrase found in any of texts (whole words), else None."""
    hay = " " + " ".join(" ".join(_tokens(t or "")) for t in texts) + " "
    for phrase in list(BLOCKLIST) + list(extra or []):
        if " " + " ".join(_tokens(phrase)) + " " in hay:
            return phrase
    return None


DANBOORU = "https://danbooru.donmai.us"


def _romaji(t: str) -> str:
    """hyuuga -> hyuga, ou -> o: Danbooru and Civitai spell long vowels differently."""
    return re.sub(r"([aeiou])\1", r"\1", t).replace("ou", "o")


def base_model_tag(name: str, series: str = "", min_posts: int = 1500, sess=None) -> tuple[str, int] | None:
    """Danbooru character tag for name if it has at least min_posts posts, else None.

    Illustrious-family checkpoints are trained on Danbooru, so a character with that many tagged
    posts draws well from the tag alone and a LoRA only adds download time and style drift.
    Raises requests.RequestException when Danbooru can't be reached."""
    want = {_romaji(t) for t in _tokens(name)}
    if not want or min_posts <= 0:
        return None
    sess = sess or requests.Session()
    best = None
    for tok in sorted(_tokens(name), key=len, reverse=True)[:2]:
        r = sess.get(f"{DANBOORU}/tags.json", timeout=15, headers={"User-Agent": UA}, params={
            "search[name_matches]": f"*{tok}*", "search[category]": 4, "search[order]": "count",
            "limit": 50, "only": "name,post_count"})
        r.raise_for_status()
        tags = r.json()
        for t in tags:
            base, _, qual = t["name"].partition("_(")
            if {_romaji(x) for x in _tokens(base)} != want or blocked([t["name"]]):
                continue
            score = (bool(series and set(_tokens(series)) & set(_tokens(qual))), t["post_count"])
            if best is None or score > best[1]:
                best = (t["name"], score)
    if best and best[1][1] >= min_posts:
        return best[0], best[1][1]
    return None


def prompt_tag(danbooru_tag: str) -> str:
    """hyuuga_hinata -> hyuuga hinata; tsunade_(naruto) -> tsunade \\(naruto\\)"""
    return danbooru_tag.replace("_", " ").replace("(", "\\(").replace(")", "\\)")


# A LoRA on a face inpaint below 0.7 doesn't hold the identity; above 0.9 it fries the face.
FACE_WEIGHT_RANGE = (0.7, 0.9)
_STRENGTH = re.compile(r"(?:weight|strength)s?\s*(?:of|:|=|at|around|between)?\s*([0-2](?:\.\d+)?)"
                       r"(?:\s*(?:-|~|–|to|and)\s*([0-2](?:\.\d+)?))?", re.I)
_LORA_TAG = re.compile(r"<lora:[^:>]+:([0-2](?:\.\d+)?)>", re.I)


def recommended_strength(model: dict, version: dict) -> float | None:
    """The author's recommended LoRA weight: Civitai's settings field, else the first weight or
    <lora:name:w> in the version or model description (a range gives its middle)."""
    st = (version.get("settings") or {}).get("strength")
    if isinstance(st, (int, float)) and 0.1 <= st <= 2:
        return float(st)
    text = re.sub(r"<(?!lora:)[^>]+>", " ", " ".join(d or "" for d in (version.get("description"), model.get("description"))))
    m = _LORA_TAG.search(text)
    if m:
        v = float(m.group(1))
    else:
        m = _STRENGTH.search(text)
        if not m:
            return None
        v = float(m.group(1)) if not m.group(2) else (float(m.group(1)) + float(m.group(2))) / 2
    return v if 0.1 <= v <= 2 else None


def face_weight(recommended: float | None, fallback: float) -> float:
    lo, hi = FACE_WEIGHT_RANGE
    return round(min(hi, max(lo, recommended if recommended else fallback)), 2)


class CivitaiError(Exception):
    pass


class Civitai:
    def __init__(self, cfg, log=print, pod=None):
        self.cfg = cfg
        self.log = log
        self.pod = pod  # mp.remote.Pod when target is runpod, else None
        self.key = cfg.civitai_key()
        self.pref = [b.lower() for b in cfg.get("base_model_preference", ["Illustrious"])]
        self.subdir = cfg.get("lora_subdir", "civitai_characters")
        self.extra_block = cfg.get("lora_blocklist", []) or []
        self.base_min_posts = int(cfg.get("base_knows_min_posts", 1500) or 0)
        self.lora_keep = {n.strip().lower() for n in cfg.get("lora_keep", []) or []}
        self.index_path = cfg.cache_dir / "lora_index.json"
        self.index = json.loads(self.index_path.read_text()) if self.index_path.exists() else {}
        self.meta_dir = cfg.cache_dir / "loras"
        self.meta_dir.mkdir(exist_ok=True)
        self.sess = requests.Session()
        self.sess.headers["User-Agent"] = UA
        if self.key:
            self.sess.headers["Authorization"] = f"Bearer {self.key}"

    # ------------------------------------------------------------------ search
    def _get(self, url, **params):
        for attempt in range(3):
            r = self.sess.get(url, params=params, timeout=30)
            if r.status_code == 429:
                time.sleep(2 + attempt * 3)
                continue
            r.raise_for_status()
            return r.json()
        raise CivitaiError("Civitai rate-limited three times")

    def search(self, query: str, limit: int = 20, base_models: list[str] | None = None) -> list[dict]:
        params = {"types": "LORA", "query": query, "limit": limit}
        if base_models:
            params["baseModels"] = base_models
        if not self.cfg.get("civitai_nsfw", True):
            params["nsfw"] = "false"
        return self._get(f"{API}/models", **params).get("items", [])

    def _version_rank(self, base_model: str) -> int:
        b = (base_model or "").lower()
        for i, p in enumerate(self.pref):
            if p in b:
                return i
        return 99

    def pick(self, name: str, series: str = "") -> dict | None:
        """Best matching LoRA as {model, version, file, score} or None. Whole-word matching."""
        hit = blocked([name, series], self.extra_block)
        if hit:
            raise CivitaiError(f"'{name}' is on the LoRA blocklist ({hit}); no LoRA is looked up for it")
        name_toks = _tokens(name)
        series_toks = [t for t in _tokens(series) if t not in name_toks]
        if not name_toks:
            return None
        pref_names = self.cfg.get("base_model_preference", ["Illustrious"])
        queries = [(f"{name} {series}".strip(), pref_names), (name, pref_names), (name, None)]
        seen, cands = set(), []
        for q, bases in queries:
            for m in self.search(q, base_models=bases):
                if m["id"] in seen:
                    continue
                seen.add(m["id"])
                if m.get("type") not in ("LORA", "LoCon", "DoRA"):
                    continue
                model_toks = set(_tokens(m.get("name", ""))) | {t for tag in m.get("tags", []) for t in _tokens(tag)}
                best_v = None
                for v in m.get("modelVersions", []):
                    rank = self._version_rank(v.get("baseModel", ""))
                    if rank == 99:
                        continue
                    files = [f for f in v.get("files", []) if f.get("name", "").endswith(".safetensors")]
                    if not files:
                        continue
                    if best_v is None or rank < best_v[0]:
                        best_v = (rank, v, next((x for x in files if x.get("primary")), files[0]))
                if best_v is None:
                    continue
                rank, v, f = best_v
                toks = model_toks | set(_tokens(v.get("name", ""))) | {t for w in v.get("trainedWords", []) for t in _tokens(w)}
                nm = sum(t in toks for t in name_toks)
                if nm == 0 or name_toks[0] not in toks:
                    continue
                hit = blocked([m.get("name", ""), v.get("name", ""), *m.get("tags", []), *v.get("trainedWords", [])], self.extra_block)
                if hit:
                    self.log(f"[civitai] skip {m.get('name')} (blocklist: {hit})")
                    continue
                sm = sum(t in toks for t in series_toks)
                if len(name_toks) == 1 and series_toks and sm == 0 and len(name_toks[0]) <= 4:
                    continue  # a short single name ("Rem") without the series is too ambiguous
                dl = (m.get("stats") or {}).get("downloadCount") or 0   # the API sends null for some models
                score = nm * 10 + sm * 5 - rank * 6 + math.log10(dl + 10)
                if nm == len(name_toks):
                    score += 6
                if _tokens(m.get("name", ""))[:len(name_toks)] == name_toks:
                    score += 3
                cands.append({"model": m, "version": v, "file": f, "score": score, "rank": rank})
            if cands and bases is not None:
                break
        if not cands:
            return None
        cands.sort(key=lambda c: -c["score"])
        return cands[0]

    def resolve_override(self, ref: str) -> dict | None:
        """`lora:` given as a Civitai URL or model id."""
        m = re.search(r"civitai\.com/models/(\d+)(?:.*?modelVersionId=(\d+))?", ref)
        model_id, version_id = (m.group(1), m.group(2)) if m else (ref if ref.isdigit() else None, None)
        if not model_id:
            return None
        model = self._get(f"{API}/models/{model_id}")
        versions = model.get("modelVersions", [])
        v = next((x for x in versions if str(x["id"]) == str(version_id)), None) if version_id else None
        if v is None:
            versions.sort(key=lambda x: self._version_rank(x.get("baseModel", "")))
            v = versions[0]
        files = [f for f in v.get("files", []) if f.get("name", "").endswith(".safetensors")]
        f = next((x for x in files if x.get("primary")), files[0])
        hit = blocked([model.get("name", ""), v.get("name", ""), *model.get("tags", []), *v.get("trainedWords", [])], self.extra_block)
        if hit:
            raise CivitaiError(f"Civitai model {model_id} is on the LoRA blocklist ({hit})")
        return {"model": model, "version": v, "file": f, "score": 999, "rank": self._version_rank(v.get("baseModel", ""))}

    # ------------------------------------------------------------------ store
    def _comfy_name(self, fname: str) -> str:
        return f"{self.subdir}/{fname}"

    def _write_meta(self, fname: str, cand: dict) -> None:
        (self.meta_dir / f"{fname}.json").write_text(json.dumps({
            "modelId": cand["model"]["id"], "modelName": cand["model"].get("name"),
            "versionId": cand["version"]["id"], "versionName": cand["version"].get("name"),
            "baseModel": cand["version"].get("baseModel"),
            "trainedWords": cand["version"].get("trainedWords", []),
            "strength": recommended_strength(cand["model"], cand["version"]),
            "url": f"https://civitai.com/models/{cand['model']['id']}?modelVersionId={cand['version']['id']}",
        }, indent=2))

    def _installed(self, fname: str) -> bool:
        if self.pod:
            return self.pod.remote_file_exists(f"{self.pod.comfy_dir}/models/loras/{self.subdir}/{fname}")
        p = self.cfg.loras_dir / self.subdir / fname
        return p.exists() and p.stat().st_size > 1_000_000

    def download(self, cand: dict) -> str:
        """Put the LoRA where ComfyUI will see it. Returns the name for LoraLoader."""
        f = cand["file"]
        fname = _slug(Path(f["name"]).stem) + ".safetensors"
        if self._installed(fname) and (self.meta_dir / f"{fname}.json").exists():
            return self._comfy_name(fname)
        url = f.get("downloadUrl") or f"{API}/download/models/{cand['version']['id']}"
        self.log(f"[civitai] downloading {f['name']} ({f.get('sizeKB', 0) / 1024:.0f} MB)")
        if self.pod:
            try:
                self.pod.remote_download(url, f"{self.pod.comfy_dir}/models/loras/{self.subdir}/{fname}", self.key)
            except Exception as e:  # RemoteError
                msg = str(e)
                if "401" in msg or "403" in msg or "not a safetensors" in msg:
                    raise CivitaiError("Civitai refused the download (login required). Set CIVITAI_API_KEY and retry.")
                raise CivitaiError(f"remote download failed: {msg}")
        else:
            dest_dir = self.cfg.loras_dir / self.subdir
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest, tmp = dest_dir / fname, dest_dir / (fname + ".part")
            with self.sess.get(url, stream=True, timeout=60, allow_redirects=True) as r:
                if r.status_code in (401, 403):
                    raise CivitaiError("Civitai refused the download (login required). Set CIVITAI_API_KEY and retry.")
                r.raise_for_status()
                if "text/html" in r.headers.get("content-type", ""):
                    raise CivitaiError("Civitai returned a web page instead of the file (login or consent required). Set CIVITAI_API_KEY.")
                with open(tmp, "wb") as out:
                    for chunk in r.iter_content(1 << 20):
                        out.write(chunk)
            with open(tmp, "rb") as fh:
                head = fh.read(16)
            if len(head) < 9 or head[8:9] != b"{":
                tmp.unlink(missing_ok=True)
                raise CivitaiError("downloaded file is not a safetensors file; aborting")
            tmp.rename(dest)
        self._write_meta(fname, cand)
        return self._comfy_name(fname)

    def find_installed(self, ref: str) -> str | None:
        """A filename (or stem) already in the target's loras folder. Returns the LoraLoader name."""
        stem = Path(ref).stem
        if self.pod:
            out = self.pod.ssh(f"cd {self.pod.comfy_dir}/models/loras && find . -name '*.safetensors' | sed 's|^\\./||'")
            for line in out.splitlines():
                if Path(line).stem == stem:
                    return line.strip()
            return None
        root = self.cfg.loras_dir
        if root.exists():
            for p in root.rglob("*.safetensors"):
                if p.stem == stem:
                    return str(p.relative_to(root))
        return None

    def triggers_for(self, comfy_name: str) -> list[str]:
        meta = self.meta_dir / f"{Path(comfy_name).name}.json"
        if meta.exists():
            return json.loads(meta.read_text()).get("trainedWords", [])
        return []

    def strength_for(self, comfy_name: str) -> float | None:
        meta = self.meta_dir / f"{Path(comfy_name).name}.json"
        if meta.exists():
            return json.loads(meta.read_text()).get("strength")
        return None

    # ----------------------------------------------------------------- resolve
    def resolve(self, character: dict, refresh: bool = False) -> dict:
        """Return {"lora": LoraLoader name or None, "triggers": [...], "source": str, "weight": float,
        "face_weight": the head pass's weight, the LoRA's recommended strength kept within FACE_WEIGHT_RANGE}."""
        name, series, ref = character["name"], character.get("series", ""), str(character.get("lora", "auto"))
        weight = float(character.get("lora_weight", 0.8))
        manual_trigger = character.get("trigger") or ""
        result = {"lora": None, "triggers": [], "source": "none", "weight": weight, "face_weight": face_weight(None, weight)}

        def finish(comfy_name: str, source: str):
            trig = [manual_trigger] if manual_trigger else self.triggers_for(comfy_name)
            result.update(lora=comfy_name, triggers=self._clean_triggers(trig, name), source=source,
                          face_weight=face_weight(self.strength_for(comfy_name), weight))
            return result

        if ref.lower() in ("none", "no", "off", "false"):
            result["source"] = "disabled"
            return result
        if ref.lower() != "auto":
            local = self.find_installed(ref)
            if local:
                return finish(local, f"installed:{local}")
            cand = self.resolve_override(ref)
            if cand is None:
                raise CivitaiError(f"lora '{ref}' is neither a file under models/loras nor a Civitai url/id")
            return finish(self.download(cand), f"civitai:{cand['model']['id']}")

        key = f"{name.strip().lower()}|{series.strip().lower()}"
        base = self._base_known(key, name, series, refresh)
        if base:
            result.update(triggers=[prompt_tag(base)], source=f"base-model:{base}")
            return result
        if not refresh and "lora" in self.index.get(key, {}):
            entry = self.index[key]
            if entry.get("lora") is None:
                result["source"] = "cached-miss"
                return result
            if self._installed(Path(entry["lora"]).name):
                return finish(entry["lora"], "cache")
        try:
            cand = self.pick(name, series)
        except requests.RequestException as e:
            self.log(f"[civitai] search failed ({e}); falling back to no LoRA")
            return result
        if cand is None:
            self.log(f"[civitai] no LoRA found for {name} ({series}) on {self.cfg.get('base_model_preference')}")
            self.index[key] = {**self.index.get(key, {}), "lora": None, "checked": time.time()}
            self._save_index()
            return result
        self.log(f"[civitai] match: {cand['model']['name']} / {cand['version']['name']} [{cand['version']['baseModel']}] score={cand['score']:.1f}")
        try:
            comfy_name = self.download(cand)
        except CivitaiError as e:
            self.log(f"[civitai] download failed: {e}")
            self.log("[civitai] continuing without a LoRA (identity falls back to the reference image if present)")
            result["source"] = "download-failed"
            return result
        self.index[key] = {**self.index.get(key, {}), "lora": comfy_name, "modelId": cand["model"]["id"], "checked": time.time()}
        self._save_index()
        return finish(comfy_name, f"civitai:{cand['model']['id']}")

    def _base_known(self, key: str, name: str, series: str, refresh: bool) -> str | None:
        """Danbooru tag when the checkpoint already draws this character, so no LoRA is fetched.
        lora_keep in config.yaml, or keep: true on a bundled LoRA, opts a character out (an older or
        alternate version the base model doesn't know, such as the adult Boruto-era cast)."""
        entry = self.index.get(key, {})
        if entry.get("keep") or name.strip().lower() in self.lora_keep or key in self.lora_keep:
            return None
        if not refresh and "base" in entry:
            return entry["base"] or None
        if self.base_min_posts <= 0:
            return None
        try:
            hit = base_model_tag(name, series, self.base_min_posts, self.sess)
        except (requests.RequestException, ValueError) as e:
            self.log(f"[base] Danbooru lookup failed ({e}); using a LoRA if one exists")
            return None
        tag = hit[0] if hit else ""
        if hit:
            self.log(f"[base] {name}: the checkpoint knows {tag} ({hit[1]} Danbooru posts), skipping the LoRA")
        self.index[key] = {**entry, "base": tag}
        self._save_index()
        return tag or None

    def _save_index(self):
        self.index_path.write_text(json.dumps(self.index, indent=2))

    @staticmethod
    def _clean_triggers(words: list[str], name: str) -> list[str]:
        """Civitai trainedWords often list outfits too. Keep the first, plus any naming the character."""
        if not words:
            return []
        words = [w.strip().strip(",") for w in words if w and w.strip()]
        n0 = _tokens(name)[0] if _tokens(name) else ""
        keep = [words[0]] + [w for w in words[1:] if n0 and n0 in w.lower()]
        out, seen = [], set()
        for w in keep:
            if w.lower() not in seen:
                seen.add(w.lower())
                out.append(w)
        return out[:3]
