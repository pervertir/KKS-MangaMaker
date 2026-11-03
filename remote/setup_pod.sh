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
  curl -L --fail --retry 3 --retry-delay 5 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

# --- custom nodes -----------------------------------------------------------
if [ ! -d custom_nodes/ComfyUI_IPAdapter_plus ]; then
  echo "clone ComfyUI_IPAdapter_plus"
  git clone --depth 1 https://github.com/cubiq/ComfyUI_IPAdapter_plus custom_nodes/ComfyUI_IPAdapter_plus
else
  echo "have  ComfyUI_IPAdapter_plus"
fi

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
mkdir -p "$M/loras/civitai_characters"

echo "--- disk"; df -h /workspace | tail -1
echo "--- done"
