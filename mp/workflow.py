"""Build the ComfyUI API-format graph for one shot.

Graph: checkpoint -> [LoRA chain] -> CLIP encode -> ControlNet (union promax, openpose) ->
       [IPAdapter plus from reference] -> KSampler -> VAE decode -> [ReActor swap] -> SaveImage
"""
from __future__ import annotations

import random

SDXL_BUCKETS = [(832, 1216), (896, 1152), (1024, 1024), (1152, 896), (1216, 832), (768, 1344), (1344, 768)]


def pick_size(w: int, h: int) -> tuple[int, int]:
    aspect = w / h
    return min(SDXL_BUCKETS, key=lambda b: abs(b[0] / b[1] - aspect))


def decide_identity(shot: dict, loras: list[dict]) -> str:
    """auto -> lora if any LoRA resolved, else ipadapter if a reference exists, else none."""
    want = shot.get("identity", "auto")
    has_lora = any(l["lora"] for l in loras)
    has_ref = shot.get("_reference_path") is not None
    if want == "auto":
        return "lora" if has_lora else ("ipadapter" if has_ref else "none")
    if want in ("ipadapter", "reactor") and not has_ref:
        raise ValueError(f"identity: {want} needs a reference image in the shot folder")
    return want


def count_tag(chars: list[dict], solo: bool = True) -> str:
    """Danbooru-style head count from each character's `gender` (girl by default): 1girl, solo /
    2girls / 1girl, 1boy / 3girls ... The models know these tags; listing names alone does not set the count."""
    girls = sum(1 for c in chars if str(c.get("gender", "girl")).lower() not in ("boy", "male", "man"))
    boys = len(chars) - girls
    tags = []
    if girls:
        tags.append(f"{girls}girl" + ("s" if girls > 1 else "") if girls < 6 else "6+girls")
    if boys:
        tags.append(f"{boys}boy" + ("s" if boys > 1 else "") if boys < 6 else "6+boys")
    if len(chars) == 1 and solo:
        tags.append("solo")
    elif len(chars) > 2:
        tags.append("multiple girls" if not boys else "multiple people")
    return ", ".join(tags)


def character_parts(shot: dict, loras: list[dict]) -> list[str]:
    """Per character, in characters[] order: LoRA triggers (or "Name \\(series\\)") plus its tags.
    Unnamed (generic) characters contribute only their tags."""
    parts = []
    for c, l in zip(shot["characters"], loras):
        bits = []
        if l["lora"] and l["triggers"]:
            bits += l["triggers"]
        elif not c.get("generic"):
            tag = c["name"].strip()
            if c.get("series"):
                tag += f" \\({c['series'].strip()}\\)"
            bits.append(tag)
        if c.get("tags"):
            bits.append(c["tags"])
        parts.append(", ".join(bits))
    return parts


def build_prompt(shot: dict, style: dict, loras: list[dict]) -> tuple[str, str]:
    parts = character_parts(shot, loras)
    count = count_tag(shot["characters"], shot.get("solo_tag", True))
    if shot.get("count_tag") is not None:
        count = shot["count_tag"]
    pos = ", ".join(p for p in [style["positive"], count, *parts, shot.get("prompt", "")] if p)
    neg = ", ".join(p for p in [style["negative"], shot.get("negative", "")] if p)
    return pos, neg


def build_graph(shot: dict, cfg, loras: list[dict], identity: str, pose_name: str, ref_name: str | None,
                size: tuple[int, int], seed: int, regions: list[tuple[int, int, str]] | None = None,
                depth_name: str | None = None, lines_name: str | None = None) -> dict:
    """regions: [(x0, x1, prompt)] left to right; each prompt is applied only inside its column."""
    g = {}
    nid = [0]

    def add(class_type, **inputs):
        nid[0] += 1
        g[str(nid[0])] = {"class_type": class_type, "inputs": inputs}
        return str(nid[0])

    ckpt = add("CheckpointLoaderSimple", ckpt_name=cfg["checkpoint"])
    model, clip, vae = [ckpt, 0], [ckpt, 1], [ckpt, 2]

    if identity in ("lora",) or any(l["lora"] for l in loras):
        for l in loras:
            if not l["lora"]:
                continue
            n = add("LoraLoader", model=model, clip=clip, lora_name=l["lora"],
                    strength_model=float(l["weight"]), strength_clip=float(l["weight"]))
            model, clip = [n, 0], [n, 1]

    style = cfg.style(shot.get("style", "flat_anime"))
    pos_text, neg_text = build_prompt(shot, style, loras)
    pos = add("CLIPTextEncode", text=pos_text, clip=clip)
    neg = add("CLIPTextEncode", text=neg_text, clip=clip)
    if regions:
        w, h = size
        for x0, x1, text in regions:
            rc = add("CLIPTextEncode", text=", ".join(p for p in [style["positive"], text] if p), clip=clip)
            canvas = add("SolidMask", value=0.0, width=w, height=h)
            col = add("SolidMask", value=1.0, width=max(8, x1 - x0), height=h)
            m = add("MaskComposite", destination=[canvas, 0], source=[col, 0], x=x0, y=0, operation="add")
            rm = add("ConditioningSetMask", conditioning=[rc, 0], mask=[m, 0], strength=1.0, set_cond_area="default")
            pos = add("ConditioningCombine", conditioning_1=[pos, 0], conditioning_2=[rm, 0])

    pose_img = add("LoadImage", image=pose_name)
    cn = add("ControlNetLoader", control_net_name=cfg["controlnet"])
    cn = add("SetUnionControlNetType", control_net=[cn, 0], type=cfg.get("controlnet_union_type", "openpose"))
    cn_apply = add("ControlNetApplyAdvanced", positive=[pos, 0], negative=[neg, 0], control_net=[cn, 0],
                   image=[pose_img, 0], strength=float(shot["controlnet_strength"]), start_percent=0.0,
                   end_percent=float(shot["controlnet_end"]), vae=vae)
    pos_c, neg_c = [cn_apply, 0], [cn_apply, 1]
    if depth_name:  # second pass on the same union model: body volumes and contact that bones alone miss
        depth_img = add("LoadImage", image=depth_name)
        dcn = add("SetUnionControlNetType", control_net=[cn, 0], type="depth")
        d_apply = add("ControlNetApplyAdvanced", positive=pos_c, negative=neg_c, control_net=[dcn, 0], image=[depth_img, 0],
                      strength=float(shot.get("depth_strength", 0.5)), start_percent=0.0,
                      end_percent=float(shot.get("depth_end", 0.5)), vae=vae)
        pos_c, neg_c = [d_apply, 0], [d_apply, 1]
    if lines_name:  # the background's edges from the same camera, so walls and furniture keep their perspective
        lines_img = add("LoadImage", image=lines_name)
        lcn = add("SetUnionControlNetType", control_net=[cn, 0], type="canny/lineart/anime_lineart/mlsd")
        l_apply = add("ControlNetApplyAdvanced", positive=pos_c, negative=neg_c, control_net=[lcn, 0], image=[lines_img, 0],
                      strength=float(shot.get("lines_strength", 0.45)), start_percent=0.0,
                      end_percent=float(shot.get("lines_end", 0.6)), vae=vae)
        pos_c, neg_c = [l_apply, 0], [l_apply, 1]

    ref_img = None
    if ref_name:
        ref_img = add("LoadImage", image=ref_name)

    if identity in ("ipadapter", "reactor") and ref_img:
        prep = add("PrepImageForClipVision", image=[ref_img, 0], interpolation="LANCZOS", crop_position="top", sharpening=0.0)
        ipa = add("IPAdapterModelLoader", ipadapter_file=cfg["ipadapter"])
        cv = add("CLIPVisionLoader", clip_name=cfg["clip_vision"])
        n = add("IPAdapterAdvanced", model=model, ipadapter=[ipa, 0], image=[prep, 0],
                weight=float(shot["ipadapter_weight"]), weight_type=shot.get("ipadapter_weight_type", "linear"),
                combine_embeds="concat", start_at=0.0, end_at=0.9, embeds_scaling="V only", clip_vision=[cv, 0])
        model = [n, 0]

    w, h = size
    latent = add("EmptyLatentImage", width=w, height=h, batch_size=int(shot.get("batch", 1)))
    ks = add("KSampler", model=model, positive=pos_c, negative=neg_c, latent_image=[latent, 0], seed=seed,
             steps=int(shot["steps"]), cfg=float(shot["cfg"]), sampler_name=shot["sampler"],
             scheduler=shot["scheduler"], denoise=1.0)
    img = [add("VAEDecode", samples=[ks, 0], vae=vae), 0]

    if identity == "reactor" and ref_img:
        n = add("ReActorFaceSwap", enabled=True, input_image=img, source_image=[ref_img, 0],
                swap_model=cfg.get("reactor_swap_model", "inswapper_128.onnx"), facedetection="retinaface_resnet50",
                face_restore_model="none", face_restore_visibility=1.0, codeformer_weight=0.5,
                detect_gender_input="no", detect_gender_source="no", input_faces_index="0",
                source_faces_index="0", console_log_level=1)
        img = [n, 0]

    add("SaveImage", images=img, filename_prefix=f"MangaPipeline/{shot['shot']}/render")
    return g


def new_seed(seed) -> int:
    seed = int(seed)
    return random.randint(0, 2**32 - 1) if seed < 0 else seed
