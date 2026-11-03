#!/bin/bash
# `civitai-dl` on the pod: blocklist screening (docker/civitai_bulk.py), then the user's
# civitai-bulk-downloader, installed on first use into the ComfyUI venv on the volume.
PY=/workspace/runpod-slim/ComfyUI/.venv-cu128/bin/python
[ -x "$PY" ] || PY=python3
if ! "$PY" -c "import civitai_downloader" 2>/dev/null; then
    echo "installing civitai-bulk-downloader into $PY"
    "$PY" -m pip install -q /opt/civitai-bulk-downloader || exit 1
fi
# ssh sessions don't inherit the pod's env vars; take the key from the container's environment.
if [ -z "${CIVITAI_API_KEY:-}${CAI_API_KEY:-}${CIVIT_AI_KEY:-}" ] && [ -r /proc/1/environ ]; then
    export CIVITAI_API_KEY=$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^\(CIVITAI_API_KEY\|CAI_API_KEY\|CIVIT_AI_KEY\)=//p' | head -1)
fi
exec "$PY" /opt/MangaPipeline/docker/civitai_bulk.py "$@"
