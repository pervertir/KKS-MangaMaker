"""RunPod side: find the pod, build its ComfyUI URL, run commands on it over SSH."""
from __future__ import annotations

import json
import shlex
import subprocess
from pathlib import Path


class RemoteError(Exception):
    pass


def _run(cmd: list[str], timeout: int = 60) -> str:
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise RemoteError(f"{' '.join(cmd[:3])} failed: {p.stderr.strip() or p.stdout.strip()}")
    return p.stdout


class Pod:
    """Wraps runpodctl for one named pod."""

    def __init__(self, cfg):
        r = cfg.get("runpod", {}) or {}
        self.r = r
        self.name = r.get("pod_name", "manga-comfy")
        self.ssh_key = Path(r.get("ssh_key", "~/.runpod/ssh/runpodctl-ssh-key")).expanduser()
        self.comfy_dir = r.get("comfy_dir", "/workspace/runpod-slim/ComfyUI")
        self.create_args = r.get("create_args", [])
        self._info = None

    # ---------------------------------------------------------------- lookup
    def info(self, refresh: bool = False) -> dict | None:
        if self._info is None or refresh:
            pods = json.loads(_run(["runpodctl", "pod", "list", "--all", "--name", self.name]))
            self._info = next((p for p in pods if p.get("name") == self.name), None)
        return self._info

    @property
    def id(self) -> str:
        i = self.info()
        if not i:
            raise RemoteError(f"no RunPod pod named '{self.name}'. Run: mangapipe pod create")
        return i["id"]

    def status(self) -> str:
        i = self.info(refresh=True)
        return (i or {}).get("desiredStatus", "MISSING")

    @property
    def url(self) -> str:
        return f"https://{self.id}-8188.proxy.runpod.net"

    def ssh_target(self) -> tuple[str, int]:
        # `runpodctl pod get` carries ssh.ip/ssh.port as soon as the container is up;
        # `runpodctl ssh info` (3.0.1) keeps saying "not ready" long after that.
        d = json.loads(_run(["runpodctl", "pod", "get", self.id]))
        ssh = d.get("ssh") or {}
        if ssh.get("ip") and ssh.get("port"):
            return ssh["ip"], int(ssh["port"])
        raise RemoteError("pod has no public ssh port yet (container still starting?)")

    # ------------------------------------------------------------------- ssh
    def ssh(self, script: str, timeout: int = 1800) -> str:
        ip, port = self.ssh_target()
        cmd = ["ssh", "-i", str(self.ssh_key), "-p", str(port), "-o", "StrictHostKeyChecking=no",
               "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=20",
               f"root@{ip}", "bash", "-lc", shlex.quote(script)]
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if p.returncode != 0:
            raise RemoteError(f"ssh command failed ({p.returncode}): {(p.stderr or p.stdout).strip()[-1500:]}")
        return p.stdout

    def ssh_script(self, script: str, env: dict | None = None, timeout: int = 1800) -> str:
        """Run a whole bash script on the pod (fed over stdin), with optional env vars."""
        ip, port = self.ssh_target()
        prefix = " ".join(f"{k}={shlex.quote(str(v))}" for k, v in (env or {}).items())
        cmd = ["ssh", "-i", str(self.ssh_key), "-p", str(port), "-o", "StrictHostKeyChecking=no",
               "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=20",
               f"root@{ip}", f"{prefix} bash -s".strip()]
        p = subprocess.run(cmd, input=script, capture_output=True, text=True, timeout=timeout)
        if p.returncode != 0:
            raise RemoteError(f"remote script failed ({p.returncode}): {(p.stderr or p.stdout).strip()[-1500:]}")
        return p.stdout

    def remote_file_exists(self, path: str) -> bool:
        try:
            return self.ssh(f"test -s {shlex.quote(path)} && echo yes || echo no").strip() == "yes"
        except RemoteError:
            return False

    def remote_download(self, url: str, dest: str, bearer: str | None = None) -> None:
        """curl on the pod straight into dest (atomic via .part)."""
        auth = f"-H 'Authorization: Bearer {bearer}'" if bearer else ""
        script = (
            f"set -e; mkdir -p $(dirname {shlex.quote(dest)}); "
            f"curl -L --fail --retry 3 {auth} -o {shlex.quote(dest + '.part')} {shlex.quote(url)}; "
            f"head -c 16 {shlex.quote(dest + '.part')} | tail -c 8 | head -c 1 | grep -q '{{' || (echo 'not a safetensors file' >&2; rm -f {shlex.quote(dest + '.part')}; exit 2); "
            f"mv {shlex.quote(dest + '.part')} {shlex.quote(dest)}; ls -la {shlex.quote(dest)}"
        )
        self.ssh(script, timeout=3600)

    # ------------------------------------------------------------- lifecycle
    def create(self) -> dict:
        r = self.r
        # The official template (150 GB container disk) is refused as "no instances available" even when the
        # GPU is in stock; the same image with a 60 GB container disk is accepted.
        cmd = ["runpodctl", "pod", "create", "--name", self.name, "--image", r.get("image", "runpod/comfyui:1.3.3-comfyuiv0.30.0-cuda12.8"),
               "--gpu-id", r.get("gpu", "NVIDIA GeForce RTX 4090"), "--ports", "8188/http,8080/http,8888/http,22/tcp",
               "--container-disk-in-gb", str(r.get("container_disk_gb", 60)), "--volume-mount-path", "/workspace"]
        if r.get("data_center"):
            cmd += ["--data-center-ids", r["data_center"]]
        if r.get("network_volume_id"):
            cmd += ["--network-volume-id", r["network_volume_id"]]
        out = _run(cmd, timeout=800)
        self._info = None
        return json.loads(out)

    def start(self) -> None:
        _run(["runpodctl", "pod", "start", self.id], timeout=120)

    def stop(self) -> None:
        _run(["runpodctl", "pod", "stop", self.id], timeout=120)

    def remove(self) -> None:
        _run(["runpodctl", "pod", "delete", self.id], timeout=120)
