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

if [ "${MANGA_FETCH_MODELS:-1}" = "1" ]; then
    nohup "$APP/docker/bootstrap.sh" > /workspace/runpod-slim/manga_bootstrap.log 2>&1 < /dev/null &
    echo "[manga] model/LoRA downloader started; log: /workspace/runpod-slim/manga_bootstrap.log"
fi

exec /start.sh "$@"
