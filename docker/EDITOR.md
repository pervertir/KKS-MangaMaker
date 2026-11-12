# The editor in a container

`docker/Dockerfile.editor` builds the MangaMaker editor (page editor, Pose tab, Script Wizard, the
`mangapipe` CLI and the MCP server) into one image of about 420 MB. It needs no GPU: renders still run
on the RunPod pod. This is a different image from `docker/Dockerfile`, which is the ComfyUI image for
the pod itself.

## Run it

```bash
docker compose -f docker/compose.editor.yaml up --build
```

Then open http://127.0.0.1:8765. Or without compose:

```bash
docker build -f docker/Dockerfile.editor -t mangamaker-editor .
docker run --rm -p 127.0.0.1:8765:8765 -v "$PWD/shots:/app/shots" -v "$PWD/pages:/app/pages" \
  -v "$PWD/assets:/app/assets" -v "$HOME/.runpod:/root/.runpod" mangamaker-editor
```

The editor has no login, so the port is published on localhost only. Do not publish it on a public
address.

## What is mounted

| host | container | why |
|---|---|---|
| `shots/`, `pages/`, `assets/`, `cache/`, `poses/` | `/app/...` | your shots, projects, uploads, caches and saved poses stay on the host |
| `~/.runpod` | `/root/.runpod` | the RunPod login and ssh key from `runpodctl config`; needed to start, stop and render on the pod |
| `<KKS>/UserData`, `abdata`, `mods` (optional, read-only) | `/kks/...` | the Comics template pack, and rebuilding the pose libraries from the game |

Set `CIVITAI_API_KEY` in the environment (or a `.env` file next to the compose file) for LoRA lookups.
Paths inside the container come from `docker/editor.config.yaml`; mount your own file on
`/app/config.local.yaml` to change them. The lettering font in the container is Comic Neue.

## MCP server from the same image

```bash
MANGAMAKER_MCP_TOKEN=some-secret docker compose -f docker/compose.editor.yaml --profile mcp up
```

serves the MCP endpoint on http://127.0.0.1:8766/mcp (see `docs/MCP.md`).

## How the image is built

1. `node:22-alpine` builds the web app in `ui/web` (Vite + Svelte) into static files.
2. `python:3.12-slim` gets Pillow, NumPy, PyYAML and requests, `runpodctl`, zsh (the launchers are zsh
   scripts), an ssh client (`mangapipe pod setup` works over ssh) and the Comic Neue font, then the
   pipeline code and the built web app.

`docker/Dockerfile.editor.dockerignore` keeps renders, projects, caches and local config out of the image.
