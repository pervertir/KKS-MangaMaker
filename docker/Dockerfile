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
COPY docker/models.yaml docker/fetch_models.py docker/README.md /opt/MangaPipeline/docker/
COPY --chmod=755 docker/entry.sh docker/bootstrap.sh /opt/MangaPipeline/docker/
COPY --chmod=755 docker/mangapipe.sh /usr/local/bin/mangapipe

ENV MANGA_HOME=/workspace/MangaPipeline \
    MANGA_LORA_SETS=all \
    MANGA_FETCH_MODELS=1

ENTRYPOINT ["/opt/MangaPipeline/docker/entry.sh"]
