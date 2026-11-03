# syntax=docker/dockerfile:1.7
# MangaPipeline on top of the official RunPod ComfyUI image.
#
# Build context is the MangaPipeline/ folder:
#   docker buildx build --platform linux/amd64 -f docker/Dockerfile -t <registry>/kks-mangamaker-comfyui:<tag> --push .
#
# Only ADD/COPY steps (no RUN), so BuildKit never has to pull the ~5 GB base layers to build,
# and a push to Docker Hub mounts them from runpod/comfyui instead of uploading them.
# Models and LoRAs are NOT in the image: docker/fetch_models.py puts them on the network volume
# at pod start (see docker/README.md). No API key is ever baked in.
FROM runpod/comfyui:1.3.3-comfyuiv0.30.0-cuda12.8

# IPAdapter nodes, baked into the image's ComfyUI bundle: /start.sh copies /opt/comfyui-baked to a
# fresh volume, and docker/entry.sh copies the node into an existing volume that lacks it.
ADD https://github.com/cubiq/ComfyUI_IPAdapter_plus.git#a0f451a5113cf9becb0847b92884cb10cbdec0ef \
    /opt/comfyui-baked/custom_nodes/ComfyUI_IPAdapter_plus

# The user's Civitai bulk downloader; `civitai-dl` pip-installs it into the ComfyUI venv on first use.
ADD https://github.com/deepratna-awale/civitai-bulk-downloader.git#e2d43fccdd12614bc92de5345900cd39a3896b10 \
    /opt/civitai-bulk-downloader

# Dialogue font (Comic Neue, SIL OFL), standing in for the Mac's Comic Sans.
ADD https://github.com/google/fonts/raw/main/ofl/comicneue/ComicNeue-Regular.ttf \
    https://github.com/google/fonts/raw/main/ofl/comicneue/ComicNeue-Bold.ttf \
    https://github.com/google/fonts/raw/main/ofl/comicneue/OFL.txt \
    /usr/share/fonts/truetype/comic-neue/

COPY mangapipe.py styles.yaml README.md /opt/MangaPipeline/
COPY mp/ /opt/MangaPipeline/mp/
COPY remote/ /opt/MangaPipeline/remote/
COPY workflows/ /opt/MangaPipeline/workflows/
COPY scripts/_example.yaml /opt/MangaPipeline/seed/scripts/_example.yaml
COPY shots/_example/ /opt/MangaPipeline/seed/shots/_example/
COPY docker/config.pod.yaml /opt/MangaPipeline/config.yaml
COPY docker/models.yaml docker/fetch_models.py docker/civitai_bulk.py docker/README.md docker/WORKFLOW.md /opt/MangaPipeline/docker/
COPY --chmod=755 docker/entry.sh docker/bootstrap.sh /opt/MangaPipeline/docker/
COPY --chmod=755 docker/mangapipe.sh /usr/local/bin/mangapipe
COPY --chmod=755 docker/civitai-dl.sh /usr/local/bin/civitai-dl
# Keeps JupyterLab's .ipynb_checkpoints out of /workspace (and so out of ComfyUI's models folders).
COPY docker/jupyter_server_config.py /etc/jupyter/jupyter_server_config.py

ENV MANGA_HOME=/workspace/MangaPipeline \
    MANGA_LORA_SETS=all \
    MANGA_FETCH_MODELS=1

ENTRYPOINT ["/opt/MangaPipeline/docker/entry.sh"]
