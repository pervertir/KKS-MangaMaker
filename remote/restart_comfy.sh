#!/bin/bash
# Runs ON the pod. Restarts ComfyUI in place. The image's /start.sh does not restart main.py when it
# exits (it prints a crash banner and sleeps), so we relaunch it ourselves, detached from this ssh session.
set -u
C=${COMFY_DIR:-/workspace/runpod-slim/ComfyUI}
cd "$C"
PID=$(pgrep -f "main.py --listen" | head -1 || true)
PY=python
if [ -n "${PID:-}" ]; then
  PY=$(readlink -f "/proc/$PID/exe" || echo python)
  kill "$PID" 2>/dev/null || true
  for i in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
  kill -9 "$PID" 2>/dev/null || true
elif [ -x "$C/.venv-cu128/bin/python" ]; then
  PY="$C/.venv-cu128/bin/python"
fi
ARGS=(--listen 0.0.0.0 --port 8188 --enable-cors-header)
if [ -f /workspace/runpod-slim/comfyui_args.txt ]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    ARGS+=($line)
  done < /workspace/runpod-slim/comfyui_args.txt
fi
echo "relaunching: $PY main.py ${ARGS[*]}"
setsid nohup "$PY" main.py "${ARGS[@]}" > /workspace/runpod-slim/comfyui_restart.log 2>&1 < /dev/null &
disown || true
sleep 2
pgrep -f "main.py --listen" >/dev/null && echo "started" || { echo "failed to start; see /workspace/runpod-slim/comfyui_restart.log"; exit 1; }
