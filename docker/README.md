# MangaPipeline RunPod image

`runpod/comfyui:1.3.3-comfyuiv0.30.0-cuda12.8` plus MangaPipeline, the IPAdapter nodes and a
start-time downloader. ComfyUI, ssh, FileBrowser (:8080) and Jupyter behave exactly as in the
official image; `docker/entry.sh` only adds two steps before handing over to the image's `/start.sh`.

## What happens at pod start

1. `/workspace/MangaPipeline/{shots,pages,scripts,cache,cap,Templates}` are created on the network
   volume and linked into `/opt/MangaPipeline`, so renders, pages and LoRA metadata survive the pod.
2. `ComfyUI_IPAdapter_plus` is copied into the volume's ComfyUI if it is missing (a fresh volume
   gets it from the image's baked ComfyUI).
3. In the background, `docker/fetch_models.py` downloads what `docker/models.yaml` lists and is
   not on the volume yet: the WAI Illustrious v16 checkpoint, xinsir union ControlNet promax,
   IPAdapter plus + CLIP-H (about 12 GB, Hugging Face, no login), then the Civitai LoRAs
   (about 6 GB, needs `CIVITAI_API_KEY`). Log: `/workspace/runpod-slim/manga_bootstrap.log`.
   ComfyUI sees new files without a restart.

Second and later starts on the same volume skip everything already there, so they take seconds.

## Deploying

Create the pod from the pushed image instead of the official one, on the existing `manga-comfy`
volume, with these environment variables:

| variable | value |
|---|---|
| `CIVITAI_API_KEY` | `{{ RUNPOD_SECRET_civitai_api_key }}` (create the secret once in RunPod > Secrets; the key is never in the image) |
| `MANGA_LORA_SETS` | `all` (default), `characters`, `acts`, or `none` |
| `MANGA_FETCH_MODELS` | `0` to skip the downloader entirely |
| `PUBLIC_KEY` | your ssh public key, as with the official image |

With runpodctl: `config.yaml` > `runpod.image: <registry>/kks-mangamaker-comfyui:<tag>` and
`./mangapipe pod create` (the env vars are set in the RunPod console template, or with
`runpodctl pod create --env`).

## Using the pipeline on the pod

```bash
mangapipe run /workspace/MangaPipeline/shots/<shot>      # same commands as on the Mac
mangapipe page /workspace/MangaPipeline/scripts/ch1.yaml --pdf
```

Upload shots (the F11 captures and `shot.yaml`) and the `UserData/cap/Comics/Templates` folder to
`/workspace/MangaPipeline/` once, with FileBrowser on port 8080, `runpodctl send`, or scp. The
dialogue font is Comic Neue (the Mac uses Comic Sans).

**Other ComfyUI over the API:** `COMFYUI_URL=https://<pod-id>-8188.proxy.runpod.net mangapipe run ...`
drives any ComfyUI instead of the local one. The models and LoRAs must exist on that server.

**From the Mac, as before:** nothing changes. `./mangapipe run` on the Mac talks to this pod's
ComfyUI over the proxy URL exactly as it did with the official image.

## Downloaded at start vs baked into the image

Downloaded at start (what this image does):
- the image stays a few MB on top of the base, so building and pushing is quick, and RunPod hosts
  cache the base layers;
- models live once on the 50 GB volume and survive image upgrades;
- the Civitai key stays a RunPod secret, never in an image layer;
- the first start on an empty volume takes about 10 to 20 minutes of downloads.

Baked into the image (not chosen):
- the first start is instant even without a volume, useful for throwaway pods in other regions;
- but the image grows by about 18 GB, every rebuild re-uploads it, pod starts pull it on every new
  host (often slower than the downloads), and baking Civitai files needs the key at build time.

## Content scope

Characters are canonical adults in their adult versions only. NSFW concept LoRAs are for use with
those characters. Enforced in two places:
- `docker/models.yaml` lists only adult versions (Boruto-era or older adults);
- `mp/civitai.py` `BLOCKLIST` refuses any LoRA (bundled, `lora: auto` search, or an explicit
  Civitai URL) whose name, tags or trigger words mention minors, child-era versions, loli/shota
  styles or Boruto's kids by name. A shot naming one of those characters fails instead of rendering.

Bundled characters: adult Hinata (Boruto anime, and manga ch. 700), adult Sakura, adult Ino,
adult Temari, Tsunade, Kurenai, Konan, Mei Terumi, Anko (Shippuden, adult), Shizune, Samui,
Delta, adult Naruto (Hokage), adult Sasuke. `lora: auto` with these names (series Naruto or
Boruto) uses the bundled adult file.

Left out on purpose:
- all Boruto-generation kids (Boruto, Sarada, Himawari, Mitsuki, Kawaki, Chocho, Inojin, Shikadai)
  and every Part 1 / genin version;
- Shippuden-era Hinata, Sakura, Ino, Tenten, Temari (15 to 17 in Shippuden), Hanabi, Karin, Fuu;
- ambiguous, listed for you to decide: "Young Tsunade" LoRAs (flashback age unclear), Kushina
  (trained on anime that includes child flashbacks), Ada and Eida (Boruto: Two Blue Vortex, age
  not clearly stated), "Naruto Bomb" doujin style LoRA (mixed content).

Concept LoRAs: missionary (2), doggystyle (2), cowgirl (3 angles), mating press (2), spooning,
standing sex (2), sex on table, fellatio, paizuri on lap, cross-section, after sex. Non-consent,
"size difference" and asphyxiation concepts were not included.
