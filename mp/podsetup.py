"""Set up the pod's ComfyUI over HTTP only (no SSH needed).

Uses two custom nodes the official RunPod ComfyUI image ships:
  - ComfyUI-RunpodDirect  POST /server_download/start   -> model downloads straight into models/<dir>
  - ComfyUI-Manager       POST /manager/queue/install    -> custom node packs, then GET /manager/reboot
"""
from __future__ import annotations

import time

import requests

MODELS = [
    # (url, save_path key, filename)
    ("https://huggingface.co/Ine007/waiIllustriousSDXL_v160/resolve/main/waiIllustriousSDXL_v160.safetensors",
     "checkpoints", "waiIllustriousSDXL_v160.safetensors"),
    ("https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors",
     "controlnet", "xinsir_controlnet_union-sdxl-1-promax.safetensors"),
    ("https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors",
     "ipadapter", "ip-adapter-plus_sdxl_vit-h.safetensors"),
    ("https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors",
     "clip_vision", "clip_vision_h.safetensors"),
]
NODE_PACKS = [{"id": "ComfyUI_IPAdapter_plus", "git": "https://github.com/cubiq/ComfyUI_IPAdapter_plus"}]  # Manager list key


class PodSetupError(Exception):
    pass


class PodSetup:
    def __init__(self, url: str, log=print):
        self.url = url.rstrip("/")
        self.log = log

    def _get(self, path, **kw):
        r = requests.get(self.url + path, timeout=kw.pop("timeout", 60), **kw)
        return r

    def _post(self, path, payload, timeout=120):
        return requests.post(self.url + path, json=payload, timeout=timeout)

    # ---------------------------------------------------------------- models
    def folder_paths(self) -> dict:
        r = self._get("/server_download/folder_paths")
        if r.status_code != 200:
            raise PodSetupError("RunpodDirect is not active on this ComfyUI (no /server_download/folder_paths)")
        return r.json()

    def have_model(self, save_path: str, filename: str) -> bool:
        info = requests.get(self.url + "/object_info", timeout=120).json()
        node, field = {"checkpoints": ("CheckpointLoaderSimple", "ckpt_name"), "controlnet": ("ControlNetLoader", "control_net_name"),
                       "ipadapter": ("IPAdapterModelLoader", "ipadapter_file"), "clip_vision": ("CLIPVisionLoader", "clip_name"),
                       "loras": ("LoraLoader", "lora_name")}[save_path]
        try:
            return filename in info[node]["input"]["required"][field][0]
        except KeyError:
            return False

    def start_download(self, url: str, save_path: str, filename: str) -> str:
        r = self._post("/server_download/start", {"url": url, "save_path": save_path, "filename": filename})
        if r.status_code != 200:
            raise PodSetupError(f"download start failed ({r.status_code}): {r.text[:300]}")
        j = r.json()
        did = j.get("download_id") or j.get("id") or j.get("task_id")
        if not did:
            raise PodSetupError(f"no download id in {j}")
        return str(did)

    def wait_downloads(self, ids: dict[str, str], timeout: int = 3600) -> None:
        t0 = time.time()
        pending = dict(ids)
        last = {}
        while pending and time.time() - t0 < timeout:
            for name, did in list(pending.items()):
                r = self._get(f"/server_download/status/{did}")
                if r.status_code != 200:
                    continue
                st = r.json()
                state = str(st.get("status") or st.get("state") or "").lower()
                prog = st.get("progress") or st.get("percent") or st.get("downloaded_bytes")
                key = (state, int(prog) if isinstance(prog, (int, float)) else prog)
                if last.get(name) != key:
                    self.log(f"[pod] {name}: {state} {prog if prog is not None else ''}")
                    last[name] = key
                if state in ("completed", "complete", "done", "finished", "success"):
                    pending.pop(name)
                elif state in ("failed", "error", "cancelled"):
                    raise PodSetupError(f"download of {name} failed: {st}")
            time.sleep(5)
        if pending:
            raise PodSetupError(f"timed out waiting for {', '.join(pending)}")

    def install_models(self) -> list[str]:
        """Start every download whose folder key exists; wait; return the filenames that had no folder yet."""
        folders = self.folder_paths()
        ids, deferred = {}, []
        for url, save_path, filename in MODELS:
            if self.have_model(save_path, filename):
                self.log(f"[pod] have {filename}")
                continue
            if save_path not in folders:
                deferred.append(filename)  # e.g. models/ipadapter appears only once IPAdapter_plus has loaded
                continue
            ids[filename] = self.start_download(url, save_path, filename)
            self.log(f"[pod] downloading {filename} -> models/{save_path}")
        if ids:
            self.wait_downloads(ids)
        return deferred

    # ----------------------------------------------------------------- nodes
    def manager_ok(self) -> bool:
        return self._get("/manager/version").status_code == 200

    def node_installed(self, class_name: str) -> bool:
        info = requests.get(self.url + "/object_info", timeout=120).json()
        return class_name in info

    def _queue_idle(self) -> dict:
        return self._get("/manager/queue/status").json()

    def _wait_queue(self, timeout: int = 900) -> None:
        t0 = time.time()
        while time.time() - t0 < timeout:
            st = self._queue_idle()
            if not st.get("is_processing") and st.get("in_progress_count", 0) == 0:
                return
            time.sleep(5)
        raise PodSetupError("ComfyUI-Manager install queue did not finish in time")

    def _pack_state(self, key: str) -> str:
        r = self._get("/customnode/getlist?mode=cache", timeout=120)
        if r.status_code != 200:
            return "unknown"
        return (r.json().get("node_packs", {}).get(key) or {}).get("state", "unknown")

    def install_node_packs(self) -> bool:
        """Queue the packs through ComfyUI-Manager. Returns True when a reboot is needed."""
        if self.node_installed("IPAdapterAdvanced"):
            self.log("[pod] have ComfyUI_IPAdapter_plus")
            return False
        if not self.manager_ok():
            raise PodSetupError("ComfyUI-Manager not answering; install ComfyUI_IPAdapter_plus by hand")
        self._wait_queue()
        queued = False
        for pack in NODE_PACKS:
            state = self._pack_state(pack["id"])
            if state in ("installed", "enabled", "disabled"):
                self.log(f"[pod] {pack['id']} already cloned ({state}); needs a reboot to load")
                continue
            # this pack has no registry (cnr) entry in the Manager list, so install it the git-clone way
            payload = {"id": pack["id"], "version": "unknown", "selected_version": "unknown", "skip_post_install": False,
                       "mode": "remote", "channel": "default", "ui_id": "mangapipe", "files": [pack["git"]], "install_type": "git-clone"}
            r = self._post("/manager/queue/install", payload)
            if r.status_code != 200:
                raise PodSetupError(f"manager refused install of {pack['id']} ({r.status_code}): {r.text[:300]}")
            self.log(f"[pod] queued install of {pack['id']}")
            queued = True
        if queued:
            r = self._post("/manager/queue/start", {})
            if r.status_code not in (200, 201):
                raise PodSetupError(f"manager queue start failed ({r.status_code}): {r.text[:300]}")
            self._wait_queue()
            self.log("[pod] install queue finished")
        return True

    def reboot(self, timeout: int = 600) -> None:
        try:
            self._get("/manager/reboot", timeout=10)
        except requests.RequestException:
            pass
        time.sleep(10)
        t0 = time.time()
        while time.time() - t0 < timeout:
            try:
                if self._get("/system_stats", timeout=10).status_code == 200:
                    return
            except requests.RequestException:
                pass
            time.sleep(5)
        raise PodSetupError("ComfyUI did not come back after reboot")

    def run(self) -> None:
        need_reboot = self.install_node_packs()
        deferred = self.install_models()
        if need_reboot or deferred:
            self.log("[pod] rebooting ComfyUI so new nodes and model folders register")
            self.reboot()
        if deferred:
            still = self.install_models()
            if still:
                raise PodSetupError("no model folder for: " + ", ".join(still) + " (is ComfyUI_IPAdapter_plus loaded?)")
        missing = [f for _, sp, f in MODELS if not self.have_model(sp, f)]
        if not self.node_installed("IPAdapterAdvanced"):
            missing.append("ComfyUI_IPAdapter_plus (nodes)")
        if missing:
            raise PodSetupError("still missing after setup: " + ", ".join(missing))
        self.log("[pod] setup complete: nodes and models present")
