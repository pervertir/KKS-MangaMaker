"""KKS-MangaMaker as an MCP server (stdio): write a script, get pages, pose the shots, render on the pod.

Speaks the Model Context Protocol over stdin/stdout as newline-delimited JSON-RPC, with no SDK
dependency, so it runs on the same interpreter as `mangapipe`:

    ./mangamaker-mcp                     # or: python mangamaker_mcp.py
    claude mcp add kks-mangamaker -- /path/to/KKS-MangaMaker/mangamaker-mcp

The editor (./mangapipe-ui, http://127.0.0.1:8765) opens whatever these tools write: projects in
pages/<name>/project.json, shots in shots/<name>/.
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
import re
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "ui"))

PROTOCOL = "2025-06-18"
GUIDE = ROOT / "docs" / "SCRIPT_WIZARD.md"


def _srv():
    with contextlib.redirect_stdout(sys.stderr):
        import server as srv  # ui/server.py: shot, cast and pose helpers shared with the editor
    return srv


# ------------------------------------------------------------------------------------- tools
def t_script_format(_: dict) -> str:
    return GUIDE.read_text(encoding="utf-8") if GUIDE.exists() else "docs/SCRIPT_WIZARD.md is missing"


def t_check_script(a: dict) -> dict:
    from mp.wizard import parse_script, summarize
    return summarize(parse_script(a["script"], int(a.get("max_panels_per_page") or 6)))


def t_build_pages(a: dict) -> dict:
    from mp.wizard import build_document, parse_script, summarize
    srv = _srv()
    project = a["project"].strip()
    if not srv.NAME_RE.match(project):
        raise ValueError("project name: letters, digits, space, _ - . only")
    pages = parse_script(a["script"], int(a.get("max_panels_per_page") or 6))
    if not pages:
        raise ValueError("the script has no panels")
    dest = srv.PROJECTS / project / "project.json"
    existing = json.loads(dest.read_text()) if a.get("mode") == "append" and dest.exists() else None
    reading = a.get("reading") or (existing or {}).get("reading") or "rtl"
    prefix = re.sub(r"[^\w\-.]", "_", a.get("shot_prefix") or project)[:40]
    doc, shots = build_document(pages, a.get("title") or project, reading, prefix, a.get("series", ""), a.get("make_shots", True),
                                first_page=len(existing["pages"]) + 1 if existing else 1)
    if existing:
        existing["pages"] += doc["pages"]
        doc = existing
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    made, skipped = [], []
    for s in shots:
        try:
            srv.create_shot({**s, "keep": True, "cast": True})
            made.append(s["name"])
        except ValueError as e:
            skipped.append(f"{s['name']}: {e}")
    return {"project": str(dest.relative_to(ROOT)), "open": f"http://127.0.0.1:8765 (File › Open… › {project})", "shots_created": made,
            "shots_skipped": skipped, **summarize(pages)}


def t_list_shots(_: dict) -> list[dict]:
    import yaml
    out = []
    for s in _srv().shots():
        y = yaml.safe_load(s["yaml"] or "{}") or {}
        out.append({"shot": s["name"], "characters": [c.get("name") for c in (y.get("characters") or []) if isinstance(c, dict)],
                    "prompt": y.get("prompt", ""), "posed": bool(s["pose"]), "renders": len(s["renders"]), "style": y.get("style")})
    return out


def _library():
    lib = _srv().pose_library()
    poses = {p["id"]: p for p in lib["poses"]}
    for p in lib["poses"]:
        for i, m in enumerate(p.get("members") or []):
            poses[f"{p['id']}#{i}"] = m
    return lib, poses


def t_list_poses(a: dict) -> dict:
    lib, _ = _library()
    kind, q, lim = a.get("type"), (a.get("search") or "").lower(), int(a.get("limit") or 40)
    hits = [p for p in lib["poses"] if (not kind or p.get("kind") == kind) and (not q or q in (p["name"] + " " + p.get("kind", "")).lower())]
    return {"types": lib.get("kinds", []), "total": len(hits),
            "poses": [{"id": p["id"], "name": p["name"], "type": p.get("kind"), "figures": len(p.get("members") or [1])} for p in hits[:lim]]}


def t_pose_shot(a: dict) -> dict:
    import yaml
    from mp.poserender import frame, new_char, render
    srv = _srv()
    d = srv.shot_dir(a["shot"], must_exist=False)      # a new shot is created by save_pose_shot
    side = next((d / n for n in srv.SIDECAR_NAMES if (d / n).exists()), None) if d.exists() else None
    known = (yaml.safe_load(side.read_text(encoding="utf-8")) or {}).get("characters", []) if side else []
    lib, poses = _library()
    w, h = (int(v) for v in str(a.get("canvas") or "832x1216").lower().split("x"))
    scene = {"w": w, "h": h, "prompt": a.get("prompt") or "", "chars": []}
    figs = a.get("figures") or []
    for i, f in enumerate(figs):
        pid = f["pose"]
        group = next((p for p in lib["poses"] if p["id"] == pid and p.get("members")), None)
        if group:                                   # a group pose brings every member, in place
            ga, sa = group.get("aspect", 0.7), w / h
            fit = min(1.0, sa / ga)
            for j, m in enumerate(group["members"]):
                scene["chars"].append(new_char(f"{pid}#{j}", 0.5 + (m["x"] - 0.5) * ga / sa * fit, y=m["y"], scale=m["scale"] * fit,
                                               z=m.get("z", 0), gender=m.get("gender", "girl"), label=m.get("label")))
            continue
        if pid not in poses:
            raise ValueError(f"unknown pose {pid!r}; see list_poses")
        x = f.get("x", (i + 1) / (len(figs) + 1))
        scene["chars"].append(new_char(pid, x, scale=f.get("scale"), yaw=f.get("yaw"), flip=f.get("flip"), y=f.get("y")))
    # names left to right: from the figures, else from the shot's characters
    order = sorted(scene["chars"], key=lambda c: c["x"])
    for i, c in enumerate(order):
        src = (figs[i] if i < len(figs) and not any(p.get("members") for p in lib["poses"] if p["id"] == figs[i]["pose"]) else {}) or {}
        k = known[i] if i < len(known) and isinstance(known[i], dict) else {}
        c["name"] = src.get("name") or k.get("name", "")
        c["series"] = k.get("series", "")
        c["gender"] = src.get("gender") or k.get("gender") or c.get("gender", "girl")
        c["tags"] = k.get("tags", "")
    if a.get("framing"):
        frame(scene, poses, a["framing"])
    png = render(scene, poses)
    buf = io.BytesIO()
    png.save(buf, "PNG")
    chars = [{"name": c["name"], "series": c["series"], "gender": c["gender"], "tags": c["tags"]} for c in order]
    srv.save_pose_shot({"name": a["shot"], "png": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
                        "scene": {**scene, "shot": a["shot"]}, "characters": srv.enrich_from_cast(chars),
                        **({"prompt": a["prompt"]} if a.get("prompt") else {})})
    return {"shot": a["shot"], "pose": f"shots/{a['shot']}/pose.png", "figures": len(scene["chars"]), "characters": [c["name"] for c in order]}


def t_pose_from_image(a: dict) -> dict:
    """Detect the people in a local image on the pod; save each as a pose (My poses); optionally pose a shot with them."""
    srv = _srv()
    p = Path(a["image"]).expanduser()
    res = srv.detect_poses(p.name, p.read_bytes())
    out = {"guide": res["guide"], "people": [{"pose": x["pose"]["id"], "type": x["pose"].get("kind"), "place": x["place"]} for x in res["people"]]}
    if a.get("shot") and res["people"]:
        ia = res["w"] / res["h"]
        canvas = min((("832x1216", 832 / 1216), ("896x1152", 896 / 1152), ("1024x1024", 1.0), ("1152x896", 1152 / 896), ("1216x832", 1216 / 832)),
                     key=lambda c: abs(c[1] - ia))[0]
        w, h = (int(v) for v in canvas.split("x"))
        figs = [{"pose": x["pose"]["id"], "x": 0.5 + (x["place"]["x"] - 0.5) * ia / (w / h), "y": x["place"]["y"], "scale": x["place"]["scale"]} for x in res["people"]]
        out["shot"] = t_pose_shot({"shot": a["shot"], "figures": figs, "canvas": canvas})
    return out


def _mangapipe(args: list[str], timeout: int) -> tuple[int, str]:
    r = subprocess.run([str(ROOT / "mangapipe"), *args], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    return r.returncode, (r.stdout + r.stderr)


def t_render_shot(a: dict) -> dict:
    args = ["run", f"shots/{_srv().shot_dir(a['shot']).name}", "--no-compose"]
    if a.get("seed") is not None:
        args += ["--seed", str(int(a["seed"]))]
    code, log = _mangapipe(args, 1800)
    lines = [l for l in log.splitlines() if l.startswith("[") or "error" in l.lower()]
    renders = sorted((ROOT / "shots" / a["shot"] / "out").glob("render_*.png"), key=lambda p: p.stat().st_mtime)
    return {"ok": code == 0, "log": lines[-25:], "latest_render": str(renders[-1].relative_to(ROOT)) if renders else None}


def t_place_renders(a: dict) -> dict:
    from PIL import Image
    srv = _srv()
    dest = srv.PROJECTS / a["project"] / "project.json"
    doc = json.loads(dest.read_text())
    placed = []
    for pg in doc["pages"]:
        for l in pg["layers"]:
            if l.get("type") != "panel" or not l.get("shot"):
                continue
            out = ROOT / "shots" / l["shot"] / "out"
            rs = sorted([p for p in out.glob("render_*.png") if not p.stem.endswith("_base")], key=lambda p: p.stat().st_mtime) if out.exists() else []
            if not rs or (l.get("image") and l.get("lockImage")):
                continue
            with Image.open(rs[-1]) as im:
                iw, ih = im.size
            l["image"] = {"ref": srv.mp_ref(rs[-1]), "iw": iw, "ih": ih, "fit": "cover", "focus": [0.5, 0.3], "zoom": 1, "flip": False}
            placed.append(l["shot"])
    dest.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    return {"placed": placed, "project": str(dest.relative_to(ROOT))}


def t_pod(a: dict) -> dict:
    act = a.get("action", "status")
    if act not in ("status", "start", "stop"):
        raise ValueError("action: status | start | stop")
    code, log = _mangapipe(["pod", act], 300)
    return {"ok": code == 0, "output": log.strip().splitlines()[-5:]}


def t_cast(a: dict) -> dict:
    srv = _srv()
    cast = json.loads(srv.CAST.read_text(encoding="utf-8")) if srv.CAST.exists() else []
    if a.get("set"):
        by = {c["name"].lower(): c for c in cast if c.get("name")}
        for c in a["set"]:
            if c.get("name"):
                by[c["name"].lower()] = {**by.get(c["name"].lower(), {}), **c}
        cast = list(by.values())
        srv.CAST.write_text(json.dumps(cast, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"cast": cast}


S = {"type": "string"}
TOOLS = {
    "script_format": (t_script_format, "The Script Wizard format and writing guide (read this before writing a script).", {}),
    "check_script": (t_check_script, "Parse a Script Wizard script without writing anything: pages, panels, characters, layout, and warnings to fix.",
                     {"script": S, "max_panels_per_page": {"type": "integer"}}, ["script"]),
    "build_pages_from_script": (t_build_pages, "Turn a script into an editor project (pages, panels, bubbles in reading order) and one shot per panel "
                                "with its characters (filled from the character sheet) and render prompt.",
                                {"script": S, "project": S, "title": S, "reading": {"type": "string", "enum": ["rtl", "ltr"]}, "shot_prefix": S,
                                 "series": S, "make_shots": {"type": "boolean"}, "mode": {"type": "string", "enum": ["new", "append"]},
                                 "max_panels_per_page": {"type": "integer"}}, ["script", "project"]),
    "list_shots": (t_list_shots, "Every shot: characters, prompt, whether it is posed, how many renders.", {}),
    "list_poses": (t_list_poses, "Search the pose library (basic, the converted studio poses, H-scene group poses, saved poses) by type or name.",
                   {"type": S, "search": S, "limit": {"type": "integer"}}),
    "pose_shot": (t_pose_shot, "Pose a shot without the editor: place figures from the pose library (a group pose id brings all its figures) and write "
                  "the OpenPose image the render uses. Figures are listed left to right.",
                  {"shot": S, "figures": {"type": "array", "items": {"type": "object", "properties": {
                      "pose": S, "name": S, "gender": {"type": "string", "enum": ["girl", "boy"]}, "x": {"type": "number"}, "y": {"type": "number"},
                      "scale": {"type": "number"}, "yaw": {"type": "number"}, "flip": {"type": "boolean"}}, "required": ["pose"]}},
                   "framing": {"type": "string", "enum": ["full", "knees", "waist", "chest", "close"]}, "canvas": S, "prompt": S}, ["shot", "figures"]),
    "pose_from_image": (t_pose_from_image, "Find every person in a local image (pose detection on the pod) and save each as a pose; with `shot`, pose that "
                        "shot with them as they stand in the picture. Only use images the user has the rights to.",
                        {"image": S, "shot": S}, ["image"]),
    "render_shot": (t_render_shot, "Render a posed shot on the RunPod pod (uses the GPU: costs money while the pod runs).",
                    {"shot": S, "seed": {"type": "integer"}}, ["shot"]),
    "place_renders": (t_place_renders, "Put each panel's latest render into a project's panels.", {"project": S}, ["project"]),
    "pod": (t_pod, "RunPod pod: status, start, or stop (stop ends GPU billing).", {"action": {"type": "string", "enum": ["status", "start", "stop"]}}),
    "cast": (t_cast, "Read the character sheet, or add/update characters (name, series, lora, tags, gender, pose).",
             {"set": {"type": "array", "items": {"type": "object"}}}),
}


def tool_list():
    out = []
    for name, spec in TOOLS.items():
        fn, desc, props = spec[:3]
        req = spec[3] if len(spec) > 3 else []
        out.append({"name": name, "description": desc, "inputSchema": {"type": "object", "properties": props, "required": req}})
    return out


def handle(msg: dict):
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
        return {"protocolVersion": (msg.get("params") or {}).get("protocolVersion", PROTOCOL), "capabilities": {"tools": {}},
                "serverInfo": {"name": "kks-mangamaker", "version": "1.0"},
                "instructions": "Write a script (read script_format first), check_script, build_pages_from_script, then pose_shot and render_shot each panel's shot, "
                                "then place_renders and open the project in the editor to letter and export."}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": tool_list()}
    if method == "tools/call":
        p = msg.get("params") or {}
        spec = TOOLS.get(p.get("name"))
        if not spec:
            return {"content": [{"type": "text", "text": f"unknown tool {p.get('name')}"}], "isError": True}
        try:
            with contextlib.redirect_stdout(sys.stderr):
                res = spec[0](p.get("arguments") or {})
            text = res if isinstance(res, str) else json.dumps(res, ensure_ascii=False, indent=1)
            return {"content": [{"type": "text", "text": text}], "isError": False}
        except Exception as e:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            return {"content": [{"type": "text", "text": f"error: {e}"}], "isError": True}
    if mid is None:
        return None                                   # notifications need no answer
    raise LookupError(method)


def main():
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            res = handle(msg)
            if msg.get("id") is None:
                continue
            reply = {"jsonrpc": "2.0", "id": msg["id"], "result": res}
        except LookupError as e:
            reply = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32601, "message": f"method not found: {e}"}}
        except Exception as e:  # noqa: BLE001
            reply = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32603, "message": str(e)}}
        out.write(json.dumps(reply, ensure_ascii=False) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
