import os
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent.parent  # MangaPipeline/


def _abs(base: Path, p) -> Path:
    p = Path(os.path.expanduser(str(p)))
    return p if p.is_absolute() else (base / p).resolve()


class Config:
    def __init__(self, path: Path | None = None):
        self.path = path or HERE / "config.yaml"
        with open(self.path, "r", encoding="utf-8") as f:
            self.raw = yaml.safe_load(f) or {}
        with open(HERE / "styles.yaml", "r", encoding="utf-8") as f:
            self.styles = yaml.safe_load(f) or {}

    def __getitem__(self, k):
        return self.raw[k]

    def get(self, k, default=None):
        return self.raw.get(k, default)

    @property
    def target(self) -> str:
        return os.environ.get("MANGAPIPE_TARGET", self.raw.get("target", "local"))

    @property
    def is_remote(self) -> bool:
        return self.target == "runpod"

    def pod(self):
        """mp.remote.Pod when target is runpod, else None (lazy, no runpodctl call until used)."""
        if not self.is_remote:
            return None
        if not hasattr(self, "_pod"):
            from .remote import Pod
            self._pod = Pod(self)
        return self._pod

    @property
    def comfy_url(self) -> str:
        if os.environ.get("COMFYUI_URL"):
            return os.environ["COMFYUI_URL"].rstrip("/")
        if self.is_remote:
            return self.pod().url
        return self.raw.get("comfy_url", "http://127.0.0.1:8188").rstrip("/")

    @property
    def comfy_root(self) -> Path:
        return _abs(HERE, self.raw["comfy_root"])

    @property
    def loras_dir(self) -> Path:
        return self.comfy_root / "models" / "loras"

    @property
    def civitai_loras_dir(self) -> Path:
        return self.loras_dir / self.raw.get("lora_subdir", "civitai_characters")

    @property
    def cap_dir(self) -> Path:
        return _abs(HERE, self.raw["cap_dir"])

    @property
    def templates_dir(self) -> Path:
        return _abs(HERE, self.raw["templates_dir"])

    @property
    def bubbles_dir(self) -> Path:
        return self.templates_dir / self.raw.get("bubbles_subdir", "Thought and Speech Bubbles")

    @property
    def cache_dir(self) -> Path:
        d = HERE / "cache"
        d.mkdir(exist_ok=True)
        return d

    @property
    def defaults(self) -> dict:
        return dict(self.raw.get("defaults", {}))

    @property
    def compose(self) -> dict:
        return dict(self.raw.get("compose", {}))

    def civitai_key(self) -> str | None:
        for name in self.raw.get("civitai_api_key_env", []):
            v = os.environ.get(name)
            if v:
                return v.strip()
        return None

    def style(self, name: str) -> dict:
        if name not in self.styles:
            raise KeyError(f"unknown style '{name}'. Known: {', '.join(self.styles)}")
        return self.styles[name]
