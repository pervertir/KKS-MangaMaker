#!/bin/bash
# Container entrypoint: prepare MangaPipeline's folders on the volume, start the model/LoRA
# downloader in the background, then hand over to the base image's /start.sh (ComfyUI, ssh,
# FileBrowser, Jupyter) unchanged.
set -u
APP=/opt/MangaPipeline
C=/workspace/runpod-slim/ComfyUI
H=${MANGA_HOME:-/workspace/MangaPipeline}

mkdir -p "$H"/{shots,pages,cache/loras,scripts,cap,Templates}
cp -rn "$APP/seed/shots/." "$H/shots/" 2>/dev/null || true
cp -rn "$APP/seed/scripts/." "$H/scripts/" 2>/dev/null || true
# The pipeline keeps its working folders next to its code; point them at the volume.
for d in shots pages cache scripts; do
    rm -rf "${APP:?}/$d"
    ln -s "$H/$d" "$APP/$d"
done

# Existing volume without the IPAdapter nodes: copy them in before ComfyUI starts.
if [ -d "$C/custom_nodes" ] && [ ! -d "$C/custom_nodes/ComfyUI_IPAdapter_plus" ]; then
    cp -r /opt/comfyui-baked/custom_nodes/ComfyUI_IPAdapter_plus "$C/custom_nodes/" \
        && echo "[manga] installed ComfyUI_IPAdapter_plus into the volume"
fi

# JupyterLab: the base /start.sh only starts it when JUPYTER_PASSWORD (or JUPYTER_DISABLE_AUTH) is
# set. Keep it on by default with a generated password, readable only on the volume and in the log.
if [ -z "${JUPYTER_PASSWORD:-}" ] && [ "${JUPYTER_DISABLE_AUTH:-}" != "true" ] && [ "${MANGA_JUPYTER:-1}" = "1" ]; then
    PWF=/workspace/runpod-slim/jupyter_password.txt
    mkdir -p /workspace/runpod-slim
    [ -s "$PWF" ] || { openssl rand -hex 12 > "$PWF"; chmod 600 "$PWF"; }
    export JUPYTER_PASSWORD=$(cat "$PWF")
    echo "[manga] JupyterLab on :8888, token in $PWF (set JUPYTER_PASSWORD to choose your own)"
fi
mkdir -p /tmp/jupyter-checkpoints
# Leftovers from before the checkpoint fix would still show up as fake models.
find /workspace/runpod-slim/ComfyUI/models -type d -name .ipynb_checkpoints -prune -exec rm -rf {} + 2>/dev/null || true

if [ "${MANGA_FETCH_MODELS:-1}" = "1" ]; then
    nohup "$APP/docker/bootstrap.sh" > /workspace/runpod-slim/manga_bootstrap.log 2>&1 < /dev/null &
    echo "[manga] model/LoRA downloader started; log: /workspace/runpod-slim/manga_bootstrap.log"
fi

exec /start.sh "$@"
