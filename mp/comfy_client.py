"""Minimal ComfyUI HTTP client: upload, validate against object_info, queue, wait, download."""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

import requests


class ComfyError(Exception):
    pass


class Comfy:
    def __init__(self, url: str, log=print):
        self.url = url.rstrip("/")
        self.log = log
        self.client_id = uuid.uuid4().hex
        self._object_info = None

    def alive(self) -> bool:
        try:
            requests.get(f"{self.url}/system_stats", timeout=5).raise_for_status()
            return True
        except requests.RequestException:
            return False

    def object_info(self) -> dict:
        if self._object_info is None:
            r = requests.get(f"{self.url}/object_info", timeout=60)
            r.raise_for_status()
            self._object_info = r.json()
        return self._object_info

    # -------------------------------------------------------------- validation
    def validate(self, graph: dict) -> list[str]:
        """Check class names and combo values (models) against the live server. Returns problems."""
        info = self.object_info()
        problems = []
        for nid, node in graph.items():
            ct = node["class_type"]
            if ct not in info:
                problems.append(f"node {nid}: class '{ct}' not installed on this ComfyUI")
                continue
            spec = info[ct]["input"]
            allinputs = {**spec.get("required", {}), **spec.get("optional", {})}
            for k, v in node["inputs"].items():
                if k not in allinputs:
                    problems.append(f"node {nid} ({ct}): unknown input '{k}'")
                    continue
                typ = allinputs[k][0]
                if ct == "LoadImage" and k == "image":
                    continue  # uploaded into input/<subfolder>/, which the combo list does not show
                if isinstance(typ, list) and not isinstance(v, list):
                    if v not in typ:
                        hint = f" (available: {', '.join(map(str, typ[:8]))}{'...' if len(typ) > 8 else ''})" if typ else " (none available)"
                        problems.append(f"node {nid} ({ct}): '{k}' = '{v}' not found{hint}")
            for k, (typ, *_) in spec.get("required", {}).items():
                if k not in node["inputs"]:
                    problems.append(f"node {nid} ({ct}): required input '{k}' missing")
        return problems

    # ------------------------------------------------------------------ upload
    def upload(self, path: Path, subfolder: str = "manga", name: str | None = None) -> str:
        with open(path, "rb") as f:
            r = requests.post(
                f"{self.url}/upload/image",
                files={"image": (name or path.name, f, "image/png")},
                data={"overwrite": "true", "subfolder": subfolder, "type": "input"},
                timeout=120,
            )
        r.raise_for_status()
        j = r.json()
        return f"{j['subfolder']}/{j['name']}" if j.get("subfolder") else j["name"]

    # ------------------------------------------------------------------- queue
    def queue(self, graph: dict) -> str:
        r = requests.post(f"{self.url}/prompt", json={"prompt": graph, "client_id": self.client_id}, timeout=60)
        if r.status_code != 200:
            try:
                err = r.json()
            except ValueError:
                err = r.text
            raise ComfyError(f"ComfyUI rejected the workflow: {json.dumps(err, indent=1)[:3000]}")
        return r.json()["prompt_id"]

    def wait(self, prompt_id: str, timeout: float = 3600, poll: float = 3.0) -> dict:
        t0 = time.time()
        last = ""
        while time.time() - t0 < timeout:
            r = requests.get(f"{self.url}/history/{prompt_id}", timeout=30)
            r.raise_for_status()
            h = r.json().get(prompt_id)
            if h:
                st = h.get("status", {})
                if st.get("status_str") == "error":
                    msgs = [m for m in st.get("messages", []) if m[0] == "execution_error"]
                    detail = msgs[0][1] if msgs else st
                    raise ComfyError(f"execution error in {detail.get('node_type', '?')}: {detail.get('exception_message', detail)}")
                return h
            q = requests.get(f"{self.url}/queue", timeout=30).json()
            running = any(p[1] == prompt_id for p in q.get("queue_running", []))
            pending = [i for i, p in enumerate(q.get("queue_pending", [])) if p[1] == prompt_id]
            state = "running" if running else (f"queued (#{pending[0] + 1})" if pending else "waiting")
            if state != last:
                self.log(f"[comfy] {state}  {int(time.time() - t0)}s")
                last = state
            time.sleep(poll)
        raise ComfyError("timed out waiting for ComfyUI")

    def download_outputs(self, history: dict, out_dir: Path, stem: str) -> list[Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        saved = []
        for nid, out in history.get("outputs", {}).items():
            for i, img in enumerate(out.get("images", [])):
                if img.get("type") != "output":
                    continue
                r = requests.get(f"{self.url}/view", params={"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": "output"}, timeout=120)
                r.raise_for_status()
                dest = out_dir / f"{stem}_{len(saved):02d}.png"
                dest.write_bytes(r.content)
                saved.append(dest)
        return saved

    def free(self):
        try:
            requests.post(f"{self.url}/free", json={"unload_models": True, "free_memory": True}, timeout=30)
        except requests.RequestException:
            pass
