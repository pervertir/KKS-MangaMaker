#!/usr/bin/env python3
"""MangaPipeline command line.

  mangapipe new  <shot_dir> --character NAME [--series SERIES]   scaffold a shot folder
  mangapipe grab <shot_dir> [--pose FILE] [--ref FILE]           copy newest F11 renders into the shot
  mangapipe lora NAME [--series SERIES] [--refresh]              test the Civitai lookup only
  mangapipe render <shot_dir> [--seed N] [--dry-run]             ComfyUI render only
  mangapipe compose <shot_dir> [--image FILE]                    dialogue overlay only
  mangapipe run <shot_dir> [--seed N] [--no-compose] [--dry-run] everything, end to end
  mangapipe pod create|setup|restart|status|url|start|stop|remove|ssh   RunPod pod lifecycle (target: runpod)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mp.civitai import Civitai, CivitaiError  # noqa: E402
from mp.comfy_client import Comfy, ComfyError  # noqa: E402
from mp.compose import compose  # noqa: E402
from mp.config import Config  # noqa: E402
from mp.remote import RemoteError  # noqa: E402
from mp.sidecar import ShotError, load_shot, write_example  # noqa: E402
from mp.studio import grab, prepare_pose, prepare_reference  # noqa: E402
from mp.workflow import build_graph, build_prompt, decide_identity, new_seed  # noqa: E402


def log(msg: str):
    print(msg, flush=True)


# ----------------------------------------------------------------------------- steps
def resolve_loras(shot: dict, cfg: Config, refresh: bool = False) -> list[dict]:
    civ = Civitai(cfg, log, cfg.pod())
    out = []
    for c in shot["characters"]:
        r = civ.resolve(c, refresh=refresh)
        tag = f"{c['name']}" + (f" ({c['series']})" if c.get("series") else "")
        if r["lora"]:
            log(f"[lora] {tag}: {r['lora']}  triggers={r['triggers']}  via {r['source']}")
        else:
            log(f"[lora] {tag}: none ({r['source']})")
        out.append(r)
    return out


def render(shot: dict, cfg: Config, seed: int | None, dry_run: bool, refresh: bool) -> list[Path]:
    loras = resolve_loras(shot, cfg, refresh) if shot["characters"] else []
    identity = decide_identity(shot, loras)
    log(f"[identity] {identity}")

    size = None
    if shot.get("width") and shot.get("height"):
        size = (int(shot["width"]), int(shot["height"]))
    pose_cn = shot["_out"] / "pose_cn.png"
    w, h = prepare_pose(shot["_pose_path"], pose_cn, size)
    log(f"[pose] {shot['_pose_path'].name} -> {w}x{h}")

    ref_cn = None
    if shot["_reference_path"] is not None and identity in ("ipadapter", "reactor"):
        ref_cn = shot["_out"] / "reference_cn.png"
        prepare_reference(shot["_reference_path"], ref_cn, shot.get("reference_crop"))

    the_seed = new_seed(seed if seed is not None else shot.get("seed", -1))
    comfy = Comfy(cfg.comfy_url, log)
    if not comfy.alive():
        hint = "run `mangapipe pod start` (then wait for `mangapipe pod status` to say ready)" if cfg.is_remote else "start it (comfy launch --background)"
        raise ComfyError(f"ComfyUI is not reachable at {cfg.comfy_url}; {hint} and retry.")

    pose_name = comfy.upload(pose_cn, "manga", f"{shot['shot']}_pose.png")
    ref_name = comfy.upload(ref_cn, "manga", f"{shot['shot']}_ref.png") if ref_cn else None

    graph = build_graph(shot, cfg, loras, identity, pose_name, ref_name, (w, h), the_seed)
    style = cfg.style(shot.get("style", "flat_anime"))
    pos, neg = build_prompt(shot, style, loras)
    (shot["_out"] / "workflow_api.json").write_text(json.dumps(graph, indent=2))
    (shot["_out"] / "prompt.txt").write_text(f"seed: {the_seed}\nidentity: {identity}\nsize: {w}x{h}\n\nPOSITIVE:\n{pos}\n\nNEGATIVE:\n{neg}\n")
    log(f"[prompt] {pos[:160]}{'...' if len(pos) > 160 else ''}")

    problems = comfy.validate(graph)
    if problems:
        log("[validate] the workflow cannot run on this ComfyUI:")
        for p in problems:
            log("   - " + p)
        raise ComfyError("fix the items above (missing model or node) and retry")
    log("[validate] ok")
    if dry_run:
        log(f"[dry-run] graph written to {shot['_out'] / 'workflow_api.json'}")
        return []

    t0 = time.time()
    pid = comfy.queue(graph)
    log(f"[comfy] queued {pid} (seed {the_seed})")
    hist = comfy.wait(pid)
    stem = f"render_{the_seed}"
    files = comfy.download_outputs(hist, shot["_out"], stem)
    log(f"[comfy] done in {time.time() - t0:.0f}s -> " + ", ".join(f.name for f in files))
    return files


def do_compose(shot: dict, cfg: Config, images: list[Path]) -> list[Path]:
    if not shot["dialogue"]:
        log("[compose] no dialogue in the sidecar; skipping")
        return []
    outs = []
    for img in images:
        stem = img.stem[len("render_"):] if img.stem.startswith("render_") else img.stem
        dest = shot["_out"] / f"final_{stem}.png"
        compose(img, shot["dialogue"], cfg.compose, cfg.bubbles_dir, dest, log)
        log(f"[compose] -> {dest}")
        outs.append(dest)
    return outs


def pod_cmd(cfg: Config, action: str, cmdline: str = "") -> int:
    if not cfg.is_remote:
        raise RemoteError("config.yaml has target: local; set target: runpod to manage a pod")
    pod = cfg.pod()
    if action == "create":
        if pod.info():
            log(f"pod '{pod.name}' already exists ({pod.id}, {pod.status()})")
        else:
            info = pod.create()
            log(f"created {info.get('id')} ({info.get('machine', {}).get('gpuDisplayName', '')})")
        log("next: mangapipe pod setup   (installs nodes + models, ~12 GB, first time only)")
        return 0
    if action == "status":
        st = pod.status()
        line = f"pod {pod.name}: {st}"
        if st == "RUNNING":
            comfy = Comfy(pod.url, log)
            line += "  ComfyUI " + ("ready" if comfy.alive() else "not answering yet (booting; first boot on the volume takes minutes)")
            line += f"  {pod.url}"
        log(line)
        return 0
    if action == "url":
        log(pod.url)
        return 0
    if action in ("setup", "restart"):
        comfy = Comfy(pod.url, log)
        here = Path(__file__).resolve().parent / "remote"
        try:
            ip, port = pod.ssh_target()
        except RemoteError:
            ip = None
        if ip:
            if action == "setup":
                log("[pod] ssh: installing ComfyUI_IPAdapter_plus and the models (skips what is already on the volume)")
                log(pod.ssh_script((here / "setup_pod.sh").read_text(), env={"COMFY_DIR": pod.comfy_dir}, timeout=3600))
            log("[pod] ssh: restarting ComfyUI")
            log(pod.ssh_script((here / "restart_comfy.sh").read_text(), env={"COMFY_DIR": pod.comfy_dir}, timeout=120))
        elif action == "setup":
            from mp.podsetup import PodSetup, PodSetupError
            if not comfy.alive():
                raise RemoteError(f"ComfyUI on the pod is not answering yet at {pod.url}; wait for `mangapipe pod status` to say ready")
            log("[pod] no ssh yet; using the pod's HTTP routes (RunpodDirect + Manager)")
            try:
                PodSetup(pod.url, log).run()
            except PodSetupError as e:
                raise RemoteError(str(e))
        else:
            raise RemoteError("restart needs ssh; the pod has not published its ssh port yet")
        import time as _t
        for _ in range(60):
            if comfy.alive():
                break
            _t.sleep(5)
        else:
            raise RemoteError("ComfyUI did not come back; see /workspace/runpod-slim/comfyui_restart.log on the pod")
        info = comfy.object_info()
        missing = [k for k in ("checkpoint", "controlnet", "ipadapter", "clip_vision") if not _model_listed(info, k, cfg)]
        if "IPAdapterAdvanced" not in info:
            missing.append("ComfyUI_IPAdapter_plus nodes")
        log("[pod] ComfyUI ready; " + ("all nodes and models present" if not missing else "MISSING: " + ", ".join(missing)))
        return 0 if not missing else 1
    if action == "start":
        pod.start(); log(f"starting {pod.id}; poll with: mangapipe pod status"); return 0
    if action == "stop":
        pod.stop(); log(f"stopped {pod.id} (volume keeps the models; you still pay for the volume, not the GPU)"); return 0
    if action == "remove":
        pod.remove(); log(f"removed pod {pod.id}; the network volume {cfg['runpod'].get('network_volume_id')} still exists"); return 0
    if action == "ssh":
        if not cmdline:
            ip, port = pod.ssh_target()
            log(f"ssh -i {pod.ssh_key} -p {port} root@{ip}")
            return 0
        log(pod.ssh(cmdline, timeout=3600))
        return 0
    return 1


def _model_listed(info: dict, key: str, cfg: Config) -> bool:
    node, field = {"checkpoint": ("CheckpointLoaderSimple", "ckpt_name"), "controlnet": ("ControlNetLoader", "control_net_name"),
                   "ipadapter": ("IPAdapterModelLoader", "ipadapter_file"), "clip_vision": ("CLIPVisionLoader", "clip_name")}[key]
    try:
        return cfg[key] in info[node]["input"]["required"][field][0]
    except (KeyError, TypeError):
        return False


# ------------------------------------------------------------------------------- cli
def main(argv=None):
    ap = argparse.ArgumentParser(prog="mangapipe", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=None)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("new");     p.add_argument("shot_dir", type=Path); p.add_argument("--character", required=True); p.add_argument("--series", default="")
    p = sub.add_parser("grab");    p.add_argument("shot_dir", type=Path); p.add_argument("--pose", type=Path); p.add_argument("--ref", type=Path)
    p = sub.add_parser("lora");    p.add_argument("name"); p.add_argument("--series", default=""); p.add_argument("--refresh", action="store_true")
    p = sub.add_parser("render");  p.add_argument("shot_dir", type=Path); p.add_argument("--seed", type=int); p.add_argument("--dry-run", action="store_true"); p.add_argument("--refresh-lora", action="store_true")
    p = sub.add_parser("compose"); p.add_argument("shot_dir", type=Path); p.add_argument("--image", type=Path, action="append")
    p = sub.add_parser("pod");     p.add_argument("action", choices=["create", "setup", "restart", "status", "url", "start", "stop", "remove", "ssh"]); p.add_argument("cmdline", nargs="?", default="")
    p = sub.add_parser("run");     p.add_argument("shot_dir", type=Path); p.add_argument("--seed", type=int); p.add_argument("--dry-run", action="store_true"); p.add_argument("--no-compose", action="store_true"); p.add_argument("--refresh-lora", action="store_true")
    a = ap.parse_args(argv)
    cfg = Config(a.config)

    try:
        if a.cmd == "new":
            p = write_example(a.shot_dir, a.character, a.series)
            log(f"wrote {p}\nnext: pose in Studio, F11 reference, swap to the OpenPose card, F11 pose, then: mangapipe grab {a.shot_dir}")
            return 0
        if a.cmd == "grab":
            grab(cfg.cap_dir, a.shot_dir, a.pose, a.ref, log)
            return 0
        if a.cmd == "lora":
            civ = Civitai(cfg, log, cfg.pod())
            r = civ.resolve({"name": a.name, "series": a.series, "lora": "auto"}, refresh=a.refresh)
            log(json.dumps(r, indent=2))
            return 0
        if a.cmd == "pod":
            return pod_cmd(cfg, a.action, a.cmdline)
        shot = load_shot(a.shot_dir, cfg)
        if a.cmd == "render":
            render(shot, cfg, a.seed, a.dry_run, a.refresh_lora)
            return 0
        if a.cmd == "compose":
            imgs = a.image or sorted(shot["_out"].glob("render_*.png"))
            if not imgs:
                raise ShotError("no render_*.png in out/; run render first or pass --image")
            do_compose(shot, cfg, [Path(i) for i in imgs])
            return 0
        if a.cmd == "run":
            files = render(shot, cfg, a.seed, a.dry_run, a.refresh_lora)
            if files and not a.no_compose:
                do_compose(shot, cfg, files)
            return 0
    except (ShotError, CivitaiError, ComfyError, RemoteError, FileNotFoundError, ValueError, KeyError) as e:
        log(f"error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
