#!/bin/bash
# `mangapipe` inside the pod image. Uses the ComfyUI venv when it exists (it sees the image's
# system packages), else the system python.
PY=/workspace/runpod-slim/ComfyUI/.venv-cu128/bin/python
[ -x "$PY" ] || PY=python3
exec "$PY" /opt/MangaPipeline/mangapipe.py "$@"
