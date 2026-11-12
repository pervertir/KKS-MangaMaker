#!/bin/bash
# Runs ON the RunPod pod (official "ComfyUI - CUDA 12.8" template) via `mangapipe pod setup`.
# Installs the custom nodes and models the MangaPipeline graph needs. Idempotent: skips what exists.
set -euo pipefail
C=${COMFY_DIR:-/workspace/runpod-slim/ComfyUI}
M="$C/models"
cd "$C"

fetch() {  # fetch <url> <dest>
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then echo "have  $(basename "$dest")"; return; fi
  mkdir -p "$(dirname "$dest")"
  echo "get   $(basename "$dest")"
  curl -L --fail --retry 3 --retry-delay 5 -o "$dest.part" "$url" || return 1
  mv "$dest.part" "$dest"
}

PYBIN="$C/.venv/bin/python"; [ -x "$PYBIN" ] || PYBIN="$(command -v python3)"

fetchzip() {  # fetchzip <url> <dir>: unpack an archive of ONNX files into <dir>, once
  local url="$1" dir="$2"
  if find "$dir" -name '*.onnx' 2>/dev/null | grep -q .; then echo "have  $(basename "$dir") (onnx)"; return; fi
  mkdir -p "$dir"
  echo "get   $(basename "$url")"
  # explicit returns: called as `fetchzip ... || echo warn`, where bash does not stop at a failed step
  curl -L --fail --retry 3 --retry-delay 5 -o "$dir/.dl.zip" "$url" || return 1
  "$PYBIN" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$dir/.dl.zip" "$dir" || return 1
  rm -f "$dir/.dl.zip"
}

# --- custom nodes -----------------------------------------------------------
if [ ! -d custom_nodes/ComfyUI_IPAdapter_plus ]; then
  echo "clone ComfyUI_IPAdapter_plus"
  git clone --depth 1 https://github.com/cubiq/ComfyUI_IPAdapter_plus custom_nodes/ComfyUI_IPAdapter_plus
else
  echo "have  ComfyUI_IPAdapter_plus"
fi

# DWPose (pose from an image, Pose tab › From image; the fallback detector, and the node that exports
# keypoints): comfyui_controlnet_aux, models fetched on first use
if [ ! -d custom_nodes/comfyui_controlnet_aux ]; then
  echo "clone comfyui_controlnet_aux"
  git clone --depth 1 https://github.com/Fannovel16/comfyui_controlnet_aux custom_nodes/comfyui_controlnet_aux
  "$PYBIN" -m pip install -q -r custom_nodes/comfyui_controlnet_aux/requirements.txt || echo "warn: controlnet_aux requirements"
else
  echo "have  comfyui_controlnet_aux"
fi

# Pose from image, second detector: YOLOX + RTMPose trained on Human-Art (drawn and anime figures), run by
# rtmlib on onnxruntime. No node pack offers these weights, so the two nodes are written here.
# --no-deps: rtmlib would otherwise pull opencv-contrib over the opencv the other nodes use.
"$PYBIN" -c 'import rtmlib' 2>/dev/null || "$PYBIN" -m pip install -q --no-deps rtmlib || echo "warn: rtmlib not installed (Human-Art pose detector unavailable)"
"$PYBIN" -c 'import onnxruntime' 2>/dev/null || "$PYBIN" -m pip install -q onnxruntime || echo "warn: onnxruntime not installed"
echo "write manga_pose_nodes.py"
cat > custom_nodes/manga_pose_nodes.py <<'PYEOF'
"""KKS-MangaMaker pose nodes (Pose tab > From image).
MangaHumanArtPose: people and their 17 body keypoints from the Human-Art-trained YOLOX + RTMPose, as an
OpenPose-18 POSE_KEYPOINT frame with the real score of every keypoint (pixels of the input image).
MangaSavePoseJSON: any POSE_KEYPOINT as plain JSON, returned with the run and written to the output folder."""
import glob
import json
import os

import folder_paths
import numpy as np

ROOT = os.path.join(folder_paths.models_dir, "rtmpose_humanart")
# COCO-17 -> OpenPose-18 (index 1, the neck, is the middle of the shoulders)
ORDER = [0, None, 6, 8, 10, 5, 7, 9, 12, 14, 16, 11, 13, 15, 2, 1, 4, 3]
_LOADED = {}


def _onnx(sub):
    hits = sorted(glob.glob(os.path.join(ROOT, sub, "**", "*.onnx"), recursive=True))
    if not hits:
        raise RuntimeError(f"no .onnx under {os.path.join(ROOT, sub)}: run `mangapipe pod setup`")
    return hits[0]


def _models():
    if "m" not in _LOADED:
        import onnxruntime as ort
        from rtmlib import RTMPose, YOLOX
        dev = "cuda" if "CUDAExecutionProvider" in ort.get_available_providers() else "cpu"
        _LOADED["m"] = (YOLOX(_onnx("det"), model_input_size=(640, 640), backend="onnxruntime", device=dev),
                        RTMPose(_onnx("pose"), model_input_size=(192, 256), backend="onnxruntime", device=dev))
    return _LOADED["m"]


class MangaHumanArtPose:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",), "box_threshold": ("FLOAT", {"default": 0.35, "min": 0.05, "max": 0.95, "step": 0.05})}}

    RETURN_TYPES = ("POSE_KEYPOINT",)
    FUNCTION = "run"
    CATEGORY = "MangaMaker"

    def run(self, image, box_threshold):
        det, pose = _models()
        det.score_thr = float(box_threshold)
        frames = []
        for im in image:
            bgr = np.ascontiguousarray((im.cpu().numpy()[..., :3] * 255).clip(0, 255).astype(np.uint8)[..., ::-1])
            h, w = bgr.shape[:2]
            boxes = det(bgr)
            if boxes is None or len(boxes) == 0:        # nobody found: read the picture as one person
                boxes = [[0, 0, w, h]]
            kps, scores = pose(bgr, bboxes=[list(map(float, b[:4])) for b in boxes])
            people = []
            for kp, sc in zip(np.asarray(kps, dtype=float), np.asarray(scores, dtype=float)):
                flat = []
                for j in ORDER:
                    if j is None:
                        x, y, s = (kp[5][0] + kp[6][0]) / 2, (kp[5][1] + kp[6][1]) / 2, min(sc[5], sc[6])
                    else:
                        x, y, s = kp[j][0], kp[j][1], sc[j]
                    flat += [float(x), float(y), float(max(0.0, min(1.0, s)))]
                people.append({"pose_keypoints_2d": flat})
            frames.append({"people": people, "canvas_width": int(w), "canvas_height": int(h)})
        return (frames,)


def _plain(v):
    if isinstance(v, dict):
        return {str(k): _plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    if hasattr(v, "tolist"):                             # numpy and torch values
        return _plain(v.tolist())
    return v


class MangaSavePoseJSON:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"pose_kps": ("POSE_KEYPOINT",), "filename_prefix": ("STRING", {"default": "PoseKeypoint"})}}

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "MangaMaker"

    def save(self, pose_kps, filename_prefix):
        data = _plain(pose_kps)
        folder, name, counter, _sub, _ = folder_paths.get_save_image_path(filename_prefix, folder_paths.get_output_directory())
        with open(os.path.join(folder, f"{name}_{counter:05}.json"), "w") as f:
            json.dump(data, f)
        return {"ui": {"openpose_json": [json.dumps(data)]}}


NODE_CLASS_MAPPINGS = {"MangaHumanArtPose": MangaHumanArtPose, "MangaSavePoseJSON": MangaSavePoseJSON}
NODE_DISPLAY_NAME_MAPPINGS = {"MangaHumanArtPose": "Human-Art Pose (MangaMaker)", "MangaSavePoseJSON": "Save Pose JSON (MangaMaker)"}
PYEOF

# --- models -----------------------------------------------------------------
# Checkpoint: WAI Illustrious SDXL v16 (single-file mirror on Hugging Face; v17 is Civitai-login only)
fetch https://huggingface.co/Ine007/waiIllustriousSDXL_v160/resolve/main/waiIllustriousSDXL_v160.safetensors \
      "$M/checkpoints/waiIllustriousSDXL_v160.safetensors"
# ControlNet union promax (openpose + everything else)
fetch https://huggingface.co/xinsir/controlnet-union-sdxl-1.0/resolve/main/diffusion_pytorch_model_promax.safetensors \
      "$M/controlnet/xinsir_controlnet_union-sdxl-1-promax.safetensors"
# IPAdapter plus (SDXL, ViT-H) + its CLIP vision encoder
fetch https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors \
      "$M/ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors"
fetch https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors \
      "$M/clip_vision/clip_vision_h.safetensors"
# SAM 3.1: finds each head for the multi-character head pass
fetch https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors \
      "$M/checkpoints/sam3.1_multiplex_fp16.safetensors"
# Pose from image (optional: a failed download only means the next detector is used).
# SDPose-Wholebody + RT-DETR person boxes: ComfyUI's own SDPoseKeypointExtractor / RTDETR_detect nodes
fetch https://huggingface.co/Comfy-Org/SDPose/resolve/main/checkpoints/sdpose_wholebody_fp16.safetensors \
      "$M/checkpoints/sdpose_wholebody_fp16.safetensors" || echo "warn: SDPose checkpoint not fetched"
fetch https://huggingface.co/Comfy-Org/SDPose/resolve/main/diffusion_models/rt_detr_v4-x-hgnet_fp16.safetensors \
      "$M/diffusion_models/rt_detr_v4-x-hgnet_fp16.safetensors" || echo "warn: RT-DETR person detector not fetched"
[ -f "$C/comfy_extras/nodes_sdpose.py" ] || echo "warn: this ComfyUI has no SDPose nodes (comfy_extras/nodes_sdpose.py); update ComfyUI to use SDPose"
# Human-Art YOLOX-x (people) + RTMPose-l (17 body points) for the MangaHumanArtPose node
fetchzip https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_x_8xb8-300e_humanart-a39d44ed.zip \
      "$M/rtmpose_humanart/det" || echo "warn: Human-Art person detector not fetched"
fetchzip https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-l_8xb256-420e_humanart-256x192-389f2cb0_20230611.zip \
      "$M/rtmpose_humanart/pose" || echo "warn: Human-Art pose model not fetched"
mkdir -p "$M/loras/civitai_characters"

echo "--- disk"; df -h /workspace | tail -1
echo "--- done"
