#!/bin/bash
# `civitai-dl` on the pod: blocklist screening (docker/civitai_bulk.py), then the user's
# civitai-bulk-downloader, installed on first use into the ComfyUI venv on the volume.
PY=/workspace/runpod-slim/ComfyUI/.venv-cu128/bin/python
[ -x "$PY" ] || PY=python3
if ! "$PY" -c "import civitai_downloader" 2>/dev/null; then
    echo "installing civitai-bulk-downloader into $PY"
    "$PY" -m pip install -q /opt/civitai-bulk-downloader || exit 1
fi
exec "$PY" /opt/MangaPipeline/docker/civitai_bulk.py "$@"
