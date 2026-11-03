#!/bin/bash
# Background job started by entry.sh. Waits for /start.sh to lay ComfyUI out on the volume,
# then downloads the base models and the LoRA sets onto it (idempotent: skips what is there).
# ComfyUI rescans models/ on every /object_info, so no restart is needed afterwards.
set -u
C=/workspace/runpod-slim/ComfyUI
for i in $(seq 1 600); do
    [ -f "$C/main.py" ] && [ -d "$C/models" ] && break
    sleep 2
done
[ -f "$C/main.py" ] || { echo "ComfyUI never appeared at $C"; exit 1; }

PY=python3
python3 -c "import yaml, requests" 2>/dev/null || PY="$C/.venv-cu128/bin/python"
"$PY" /opt/MangaPipeline/docker/fetch_models.py --comfy "$C" --home "${MANGA_HOME:-/workspace/MangaPipeline}" \
    --sets "${MANGA_LORA_SETS:-all}"
echo "--- disk"; df -h /workspace | tail -1
