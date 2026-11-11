"""Shot folder contract.

A shot is a folder containing:
    shot.yaml   (or shot.json)   - this sidecar
    pose.png                     - F11 render of the OpenPose skeleton card (RGBA or RGB)
    reference.png  (optional)    - F11 render of the real character, same camera
    out/                         - created by the pipeline

Sidecar keys (all optional except `characters` or `prompt`):
    shot: name                                   used for output filenames
    pose: pose.png                               pose image filename inside the folder
    reference: reference.png                     identity reference image (face/upper body best)
    characters:
      - name: "Rem"                              character name (Civitai search + prompt tag)
        series: "Re:Zero"                        series (Civitai search + prompt tag)
        lora: auto                               auto | none | <file in loras/> | <civitai url or model id>
        lora_weight: 0.8
        trigger: ""                              overrides the LoRA trigger words
        tags: "blue hair, maid, short hair"      appearance tags; used mostly when no LoRA
    identity: auto                               auto | lora | ipadapter | reactor | none
    prompt: "..."                                scene / action / expression
    negative: "..."                              extra negatives
    style: flat_anime                            key in styles.yaml
    width / height: 832 / 1216                   omit for auto from the pose aspect
    seed: -1, steps, cfg, sampler, scheduler, batch
    controlnet_strength, controlnet_end, ipadapter_weight, ipadapter_weight_type
    dialogue:
      - text: "Hello"
        bubble: "001"                            template number, or box | caption | sfx | none
        at: [0.5, 0.15]                          bubble centre as a fraction of the image (or pixels)
        size: 0.35                               bubble width as fraction of image width (or pixels)
        flip: false                              mirror the bubble so the tail points the other way
        rotate: 0
        font_px: 0                               0 = auto-fit
        color: auto                              text colour; auto picks black/white
        bold: false
"""
from __future__ import annotations

import json
from pathlib import Path

import yaml

SIDECAR_NAMES = ("shot.yaml", "shot.yml", "shot.json")


class ShotError(Exception):
    pass


def find_sidecar(shot_dir: Path) -> Path:
    for n in SIDECAR_NAMES:
        p = shot_dir / n
        if p.exists():
            return p
    raise ShotError(f"no shot.yaml / shot.json in {shot_dir}")


def load_shot(shot_dir: Path, cfg) -> dict:
    shot_dir = Path(shot_dir).resolve()
    if not shot_dir.is_dir():
        raise ShotError(f"shot folder not found: {shot_dir}")
    sc_path = find_sidecar(shot_dir)
    with open(sc_path, "r", encoding="utf-8") as f:
        data = json.load(f) if sc_path.suffix == ".json" else (yaml.safe_load(f) or {})

    shot = dict(cfg.defaults)
    shot.update({k: v for k, v in data.items() if v is not None})
    shot["_dir"] = shot_dir
    shot["_sidecar"] = sc_path
    shot.setdefault("shot", shot_dir.name)
    shot.setdefault("pose", "pose.png")
    shot.setdefault("identity", "auto")
    shot.setdefault("prompt", "")
    shot.setdefault("negative", "")
    shot.setdefault("dialogue", [])

    # characters: accept a single `character:` string too
    chars = shot.get("characters")
    if not chars and shot.get("character"):
        chars = [{"name": shot["character"], "series": shot.get("series", "")}]
    chars = chars or []
    norm = []
    for c in chars:
        if isinstance(c, str):
            c = {"name": c}
        c = dict(c)
        c.setdefault("series", "")
        c.setdefault("lora", "auto")
        c.setdefault("lora_weight", shot.get("lora_weight", 0.8))
        c.setdefault("trigger", "")
        c.setdefault("tags", "")
        if not c.get("name"):
            raise ShotError("every character needs a name")
        norm.append(c)
    shot["characters"] = norm

    pose = shot_dir / shot["pose"]
    if not pose.exists():
        raise ShotError(f"pose image missing: {pose}  (run `mangapipe grab <shot>` after F11 in Studio)")
    shot["_pose_path"] = pose

    ref = shot.get("reference")
    if ref is None and (shot_dir / "reference.png").exists():
        ref = "reference.png"
    shot["_reference_path"] = (shot_dir / ref) if ref and (shot_dir / ref).exists() else None
    if ref and shot["_reference_path"] is None:
        raise ShotError(f"reference image listed but missing: {shot_dir / ref}")

    # Optional depth capture (xukmi Depth item, same camera): adds a depth ControlNet pass.
    depth = shot.get("depth", "depth.png")
    shot["_depth_path"] = (shot_dir / depth) if depth and (shot_dir / depth).exists() else None

    if shot["identity"] not in ("auto", "lora", "ipadapter", "reactor", "none"):
        raise ShotError(f"identity must be auto|lora|ipadapter|reactor|none, got {shot['identity']}")
    out = shot_dir / "out"
    out.mkdir(exist_ok=True)
    shot["_out"] = out
    return shot


def write_example(shot_dir: Path, name: str, series: str = "") -> Path:
    shot_dir.mkdir(parents=True, exist_ok=True)
    p = shot_dir / "shot.yaml"
    text = f"""# MangaPipeline shot sidecar. See MangaPipeline/README.md for every key.
shot: {shot_dir.name}
pose: pose.png              # F11 render of the OpenPose card (mangapipe grab fills this)
reference: reference.png    # optional: F11 render of the real character, same camera

characters:
  - name: "{name}"
    series: "{series}"
    lora: auto                # auto | none | file.safetensors | https://civitai.com/models/...
    lora_weight: 0.8
    tags: ""                  # appearance tags used when no LoRA is found

identity: auto                # auto | lora | ipadapter | reactor | none
style: flat_anime
prompt: "standing, looking at viewer, smiling, classroom background"
negative: ""
# width: 832
# height: 1216
seed: -1

dialogue:
  - text: "Replace me."
    bubble: "001"
    at: [0.70, 0.12]
    size: 0.40
    flip: false
"""
    p.write_text(text, encoding="utf-8")
    return p
