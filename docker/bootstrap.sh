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

# Our graphs in ComfyUI's Workflows sidebar (UI format); never overwrites your edited copies.
mkdir -p "$C/user/default/workflows"
for f in /opt/MangaPipeline/comfy-workflows/*.json; do
    case "$f" in *.api.json) continue;; esac
    cp -n "$f" "$C/user/default/workflows/" 2>/dev/null || true
done

if [ -d /workspace-global ] && [ "${MANGA_GLOBAL_MODELS:-1}" = "1" ]; then
    /opt/MangaPipeline/docker/global_models.sh
fi

PY=python3
python3 -c "import yaml, requests" 2>/dev/null || PY="$C/.venv-cu128/bin/python"
"$PY" /opt/MangaPipeline/docker/fetch_models.py --comfy "$C" --home "${MANGA_HOME:-/workspace/MangaPipeline}" \
    --sets "${MANGA_LORA_SETS:-all}"
# Your own bulk list (one Civitai URL or id per line), if present.
BULK=${CIVITAI_BULK_FILE:-${MANGA_HOME:-/workspace/MangaPipeline}/civitai.txt}
if [ -s "$BULK" ]; then
    echo "--- bulk list $BULK"
    /usr/local/bin/civitai-dl -f "$BULK"
fi
echo "--- disk"; df -h /workspace | tail -1
