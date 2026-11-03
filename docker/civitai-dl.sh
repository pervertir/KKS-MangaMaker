#!/bin/bash
# `civitai-dl` on the pod: bulk Civitai downloads into ComfyUI's models folders (docker/civitai_bulk.py).
PY=python3
python3 -c "import yaml, requests" 2>/dev/null || PY=/workspace/runpod-slim/ComfyUI/.venv-cu128/bin/python
exec "$PY" /opt/MangaPipeline/docker/civitai_bulk.py "$@"
