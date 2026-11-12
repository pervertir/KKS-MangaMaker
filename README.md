# MangaPipeline

CharaStudio pose -> OpenPose capture -> ComfyUI anime render on a RunPod GPU -> dialogue overlay.
One image per shot. Dialogue is composited afterwards from `UserData/cap/Comics/Templates`,
never rendered by the model.

Nothing here touches `BepInEx/plugins` or `BepInEx/config`. Rendering runs on RunPod, not on
this Mac (`target: runpod` in `config.yaml`).

## RunPod in one minute

```bash
cd "/Volumes/980Pro/Crossover/bottles/Steam Bottle/drive_c/Program Files (x86)/KKS EX BetterRepack R12/MangaPipeline"
./mangapipe pod create     # official ComfyUI template on an RTX 4090 in EU-RO-1, 50 GB volume "manga-comfy"
./mangapipe pod setup      # first time only: IPAdapter nodes + ~12 GB of models onto the volume
./mangapipe pod status     # RUNNING + "ComfyUI ready" = go
./mangapipe run shots/<shot>
./mangapipe pod stop       # when done for the day: GPU billing stops, the volume keeps the models
```

`pod start` brings a stopped pod back with everything still installed. `pod remove` deletes the
pod (the volume stays until you delete it in the console or with `runpodctl network-volume delete`).
When the configured GPU has no stock, `pod create` tries other cards of the same class in order (RTX 5090,
RTX PRO 4500, L40S, RTX 6000 Ada, A6000, A40, 3090, A5000, L4; set `runpod.gpu_fallbacks` to change the
list) and, when no network volume pins the data centre, any data centre. `pod start` does the same when a
stopped pod's host has no free GPU: it replaces the pod, and `pod setup` reinstalls the models.
Auth comes from `~/.runpod/config.toml` (runpodctl). GPU stock moves around: if `pod create` says
no instances, change `runpod.gpu` / `runpod.data_center` in `config.yaml`; a network volume is
pinned to one data centre, so a different centre needs a new volume (`runpodctl network-volume create`).
The ComfyUI proxy URL on the pod is public and unauthenticated.

## What "the OpenPose extension" actually is in this repack

There is no OpenPose plugin DLL. The pose exporter is a **character card** that renders as an
OpenPose skeleton (coloured bones on an invisible body):

    UserData/chara/female/Koikatu_F_20230301125700107_OpenPose Adjusted_xukmi.png

You pose your real character, swap the card for the OpenPose card (pose is kept), and take a
rendered screenshot. Screencap (`KKS_Screencap`, F11) writes
`UserData/cap/CharaStudio-YYYY-MM-DD-HH-MM-SS-Render.png` with a transparent background
(config has "Transparency in rendered screenshots = rgAlpha"); the pipeline flattens it onto black,
which is what ControlNet OpenPose expects.

## Studio steps per shot

1. Build the scene and pose the character(s). Frame the camera. Do not move the camera after this.
2. **F11** = rendered screenshot of the real character (this becomes `reference.png`, used for
   identity when no LoRA exists). Space hides the UI if anything is in frame.
3. Select the character, open *Add > Character*, pick the **OpenPose Adjusted** card and use
   **Change** (the replace button, not Add). `KKS_StudioCharaOnlyLoadBody` is installed, so the pose,
   position and FK/IK state stay. For two characters, repeat for each.
4. Optional: hide the map and props (so only the skeleton renders), or leave them: the pipeline
   only needs the coloured bones on a dark/transparent background.
5. **F11** again = the pose capture.
6. In a terminal:

```bash
cd "/Volumes/980Pro/Crossover/bottles/Steam Bottle/drive_c/Program Files (x86)/KKS EX BetterRepack R12/MangaPipeline"
./mangapipe new shots/ch1_s01 --character "Rem" --series "Re:Zero"
./mangapipe grab shots/ch1_s01          # newest Render.png -> pose.png, the one before -> reference.png
# edit shots/ch1_s01/shot.yaml: prompt, dialogue, style
./mangapipe run shots/ch1_s01
```

Undo the character swap in Studio with Ctrl+Z (StudioKeybinds) or load the real card back the same way.

## Shot folder contract

```
shots/<name>/
  shot.yaml          sidecar (or shot.json)
  pose.png           F11 render of the OpenPose card (RGBA or RGB, any size)
  reference.png      optional, F11 render of the real character from the same camera
  out/
    pose_cn.png      pose resized/padded to the SDXL bucket that was used
    reference_cn.png reference as sent to IPAdapter (when used)
    workflow_api.json  the exact graph that was queued (open it in ComfyUI if you want to tweak)
    prompt.txt       seed, identity path, final positive/negative
    render_<seed>_NN.png   raw renders
    final_<seed>_NN.png    with dialogue
```

Sidecar keys (defaults come from `config.yaml` > `defaults`):

| key | meaning |
|---|---|
| `characters[]` | `name`, `series`, `lora` (`auto` / `none` / `file.safetensors` / Civitai URL or id), `lora_weight`, `trigger` (override), `tags` (appearance; used when no LoRA) |
| `identity` | `auto` / `lora` / `ipadapter` / `reactor` / `none`. `auto` = LoRA if one resolved, else IPAdapter from `reference.png`, else nothing |
| `prompt`, `negative` | scene, action, expression; appended to the style preset |
| `style` | key in `styles.yaml` (`flat_anime`, `manga_bw`, `soft_anime`) |
| `width`, `height` | omit = nearest SDXL bucket to the pose aspect |
| `seed`, `steps`, `cfg`, `sampler`, `scheduler`, `batch` | sampler settings |
| `controlnet_strength`, `controlnet_end` | pose adherence (0.9 / 0.85) |
| `ipadapter_weight`, `ipadapter_weight_type` | identity strength when IPAdapter is used |
| `reference_crop` | `[x, y, w, h]` fractions to crop the reference to the face/upper body |
| `count_tag` | overrides the automatic `1girl, solo` / `2girls` tag |
| `dialogue[]` | see below |

### Dialogue entries

```yaml
dialogue:
  - text: "So this is the new classroom?"
    bubble: "001"        # template number from Templates/Thought and Speech Bubbles (001-104)
    at: [0.72, 0.12]     # bubble centre, fractions of the image (or pixels)
    size: 0.42           # bubble width as a fraction of image width (or pixels)
    flip: false          # mirror so the tail points the other way
    rotate: 0
    font_px: 0           # 0 = largest size that fits
    color: auto          # auto = black on light bubbles, white on dark ones
    bold: false
  - text: "WHAM"
    bubble: sfx          # outlined text, no bubble
    at: [0.3, 0.6]
  - text: "Later that day"
    bubble: caption      # drawn rectangle (yellow); `box` is white
    at: [0.5, 0.95]
    size: 0.6
```

The text area inside a template bubble is found from its alpha mask (largest rectangle around
the opaque centroid), so any of the 104 bubbles works without per-template tuning. Text is
wrapped and shrunk to fit. Font: Comic Sans MS from the system (change in `config.yaml`).

## Manga pages from a script

`./mangapipe page scripts/ch1.yaml --pdf` lays shot renders into page layouts and puts the dialogue
on top, writing `pages/ch1/page_01.png ...` and `pages/ch1/ch1.pdf`. The model never renders text.
`scripts/_example.yaml` builds two pages from the example shots.

```yaml
reading: rtl                 # manga order (panels and auto-placed bubbles run right to left); ltr for western
shots_dir: shots
scale: 1.0                   # templates are 1800x2700; 2.0 for print
max_font_px: 56              # cap for fitted text, keeps sizes even across a page (font_px: N forces one size)
pages:
  - layout: 13               # Comic Strips/Template-13.png, or a grid: {rows: [[1], [1, 1]], heights: [2, 1]}
    panels:                  # fill panels in reading order; `panel: N` pins one
      - shot: ch1_s01        # newest shots/ch1_s01/out/render_*.png; `image:` picks another
        focus: [0.5, 0.2]    # crop anchor (fractions of the render) when aspects differ
        zoom: 1.0            # >1 = tighter crop around focus
        fit: cover           # or contain
        flip: false
        dialogue:            # shot.yaml dialogue keys; at/size relative to the panel
          - {text: "So this is the new classroom?", bubble: "001", at: [0.75, 0.15], size: 0.3}
      - shot: ch1_s02        # no dialogue key = the shot's own shot.yaml dialogue; [] = none
    dialogue:                # page-level captions / sfx, relative to the whole page
      - {text: "Monday morning", bubble: caption, at: [0.2, 0.035], size: 0.3}
```

- Panels are found in the template image itself (white areas inside the borders), so all 100
  templates work. `./mangapipe layouts` writes `pages/layouts.png`: every template with its number,
  panel count and fill order.
- A dialogue entry without `at` is placed automatically along the panel top, first line nearest the
  reading start. Bubbles may cross panel borders and are only kept inside the page.
- A shot with no render yet draws as a grey placeholder with its name, so a chapter can be laid out
  before rendering.
- `--page N` (repeatable) rebuilds only those pages.

## MangaMaker editor and the Pose studio (no game needed)

`./mangapipe-ui` opens the page editor on http://127.0.0.1:8765. It has two modes, switched at the
top (or Ctrl/⌘+Shift+P):

- **Page**: panels, renders, template or drawn bubbles, text, SFX, captions, screentones and speed
  lines, pages and spreads, export to PNG/PDF. Built-in panel layouts (splash, tiers, 4-koma, classic
  six, ...) and print guides (trim and safe area, View menu) need no template pack.
  File > Export book (Ctrl/⌘+Alt+E) also builds a webtoon strip (panels restacked in reading order and
  sliced, 800 px wide by default), a CBZ with ComicInfo.xml, a fixed-layout EPUB 3 and a print PDF
  (1-bit, greyscale or CMYK with black on K only, TrimBox and BleedBox) into `pages/<project>/export/`.
  The CMYK conversion uses the macOS Generic CMYK profile, or the one `MANGAMAKER_CMYK_PROFILE` points to.
- **Pose**: builds the OpenPose image for a shot instead of a CharaStudio capture. Pick a pose from the
  library (click, or drag onto the canvas) for each character, then turn, tilt, rotate, size and mirror
  it, and pose by dragging: a hand or foot pulls its whole arm or leg along (IK with soft limits:
  bones keep their length, reach eases out at full extension, elbows and knees keep the side they bend
  to), an elbow or knee swings from the shoulder or hip, and the nose turns the head. Alt-drag moves a
  single joint. The selection box has the same scale and rotation handles as a page layer. Each figure gets a name and
  series (LoRA lookup as usual) or stays unnamed (`generic: true`, described by its appearance tags),
  plus girl/boy for the `1girl, 1boy` count tags. **Save & render** writes `shots/<name>/pose.png`,
  `pose_scene.json` (reopen and edit it later) and the sidecar's characters and prompt, then renders
  on the pod. From a panel, **Pose…** opens the studio at that panel's shape and the render lands back
  in the panel.

**Script Wizard** (button in the top bar, File menu, or ⌘⇧K) is the quickest start: write the scene as plain lines
and it builds the pages, picks layouts by panel count, places drawn bubbles in reading order with tails
toward the speaker, and makes one shot per panel with its characters and prompt.

```text
[Rem] Classroom after school, sunset. Rem waits by the door.   <- a panel: [who, left to right] prompt
Rem: He said he'd come...                                       <- speech
Rem (thought): Maybe he forgot.                                 <- thought / shout / whisper
SFX: TAP TAP
! [Rem, Subaru] Rem turns around, surprised.                    <- "!" = big panel
Caption: Five minutes earlier...
---                                                             <- new page
```

Helpers for first-time manga makers:

- **Starter templates** (in the Script Wizard, or Help menu): 4-koma, dialogue page, action page and
  cover, each a short sample script showing good pacing to rewrite.
- **Check this page** (Page menu, Ctrl/⌘+Shift+C): bubbles read out of order, tails pointing out of
  their panel, text too small for print, lettering outside the safe area, overlapping bubbles, empty
  bubbles, panels with no shot or render. Each has Show and a one-click Fix (undoable).
- **Character sheet** (Pipeline menu, Ctrl/⌘+Shift+U, stored in `cast.json`): name, series, LoRA,
  looks, girl/boy and a default pose per character, filled into every shot made from a script or the
  Pose tab so a character stays the same across pages.
- **Make it manga** (Page menu): sets the page's shots to the `manga_bw` style for the next render,
  shows placed renders in greyscale, adds light screentone to each panel and suggests sound effects
  from the prompts and dialogue.
- **Tips**: a hint card for the active tool (close it, or Help › Hide tips).

In the Pose tab, **Shot presets** frame every figure the way storyboards name shots (full body, knees
up, waist up, chest up, close-up), set the camera (low, high, dutch tilt) and stage two characters
(facing, over the shoulder, foreground/background).

The pose library is `poses/library.json`: the Koikatsu Sunshine studio poses converted to OpenPose
keypoints (3D, so figures can be turned) by our own forward kinematics in `mp/kkpose.py`; nothing
from the game is copied. Rebuild it from an install with `./mangapipe poses build [--src DIR]`
(default `studio_pose_dir`, `../UserData/studio/pose`). Twelve basic poses are built in. **Save pose** keeps the selected
figure (with its turn, mirror and joint edits) and **Save group pose** keeps every figure in the scene
with its place, as one entry; both land under *My poses* (`poses/custom.json`), and a group pose drops
all its figures in at once (replacing the scene's figures, names carried over, or beside them).
The library is filtered by pose type (standing, sitting, kneeling, lying, ...).

**H-scene positions** (138 of them: foreplay, oral & service, sex, solo, girl & girl, threesome) come
from the game's H animations (`abdata/h/anim`), which are Unity animation clips rather than pose files:
`mp/khanim.py` decodes one frame of each position's main loop for every actor and stores the actors
together as a group pose, turned to the side view that separates the bodies best. Build them once with
`./mangapipe poses build-h` (needs `pip install UnityPy`); they are written to `poses/h_library.json`. `./mangapipe poses build-h-mods` does the same for the named positions that
AnimationLoader mods add (`mods/Sideloader Modpack - Animations`; 155 in this install) into
`poses/h_mods_library.json`. In the Pose tab, **Turn everyone** rotates a whole group while keeping it together.

Paths to the game (captures, templates, poses) can be overridden per machine in an untracked
`config.local.yaml` next to `config.yaml`.

## Editor source and container

The editor's front end is `ui/web`: ES modules built with Vite, with Svelte for interface components.
`./mangapipe-ui` builds it into `ui/web/dist` when the source is newer (needs Node.js 20+) and the Python
server (`ui/server.py`) serves that build.

| folder | what it holds |
|---|---|
| `ui/web/src/editor/` | the page editor, one module per concern: `state`, `history`, `drawing`, `view`, `pointer`, `tools`, `layers`, `panels-tab`, `library`, `pages`, `menus`, `jobs`, `project`, ... |
| `ui/web/src/pose/` | the Pose tab: `geometry`, `draw`, `ik`, `pointer`, `library`, `side`, `presets` |
| `ui/web/src/wizard/` | the Script Wizard: `script` (parser and page builder), `editor` (highlighting), `prompt` |
| `ui/web/src/helpers/` | page checker, starter templates, character sheet, make-it-manga, tips, guide |
| `ui/web/src/ui/` | Svelte components (`Preferences`, `JobsDrawer`, `Toasts`) and `store.svelte.js`, the state they draw from |
| `ui/web/src/main.js` | entry point: imports the modules, runs their start-up code in order, mounts the components |

Working on the UI: `cd ui/web && npm install && npm run dev` (hot reload on http://localhost:5173, API
calls go to the Python server on :8765, so keep `./mangapipe-ui` running). New interface pieces are
Svelte components that read `ui` from `store.svelte.js` and call the editor modules; `dialog(Component,
title)` in `src/ui/mount.js` shows one inside the editor's dialog.

The editor also runs in a container (no GPU needed; renders still go to the pod): see
[docker/EDITOR.md](docker/EDITOR.md) and `docker compose -f docker/compose.editor.yaml up --build`.

## MCP server (any MCP client) and script skill

`./mangamaker-mcp` is an MCP server (no extra packages) over the same pipeline, for any client that
speaks the Model Context Protocol: Claude Code and Desktop, Cursor, VS Code, Windsurf, Cline, Roo Code,
Continue, Zed, JetBrains, Codex, Gemini CLI, LM Studio, Goose, Open WebUI and others.
**[docs/MCP.md](docs/MCP.md)** has the copy-paste setup for each, the environment variables and
troubleshooting.

- **Tools**: `script_format`, `check_script`, `build_pages_from_script`, `list_shots`, `list_poses`,
  `pose_shot` (draws the OpenPose image server-side, single figures or whole group poses),
  `render_shot` (on the pod, with progress and cancellation), `place_renders`, `pod`, `cast`. Each is
  marked read-only, overwriting, or pod-using so clients can ask before the calls that cost money.
- **Prompts**: `write_manga_script`, `convert_script_to_wizard_format`, `storyboard_and_render`, and
  the Script Wizard guide as a **resource**, so clients without skills get the same guidance.
- **Transports**: stdio by default; `./mangamaker-mcp --http` serves Streamable HTTP on
  `http://127.0.0.1:8766/mcp` (local only unless you give it a token) for clients that take a URL.

The generic entry most clients accept (use the absolute path):

```json
{ "mcpServers": { "kks-mangamaker": { "command": "/path/to/KKS-MangaMaker/mangamaker-mcp", "args": [] } } }
```

`.mcp.json` registers it for Claude Code in this folder; elsewhere:
`claude mcp add kks-mangamaker -- /path/to/KKS-MangaMaker/mangamaker-mcp`. On Windows the launcher is
`mangamaker-mcp.cmd`. The launcher uses `$MANGAPIPE_PYTHON`, else the `comfyui` conda environment,
else `python3`, and says which packages are missing if that interpreter lacks them.

`.claude/skills/kks-mangamaker-script` is the script-writing skill for clients that load skills (it
also builds, poses and renders through the MCP server). The format and craft notes are in
[docs/SCRIPT_WIZARD.md](docs/SCRIPT_WIZARD.md), also in the editor under Help › Script Wizard guide.

## Commands

| command | does |
|---|---|
| `./mangapipe new DIR --character N [--series S]` | scaffold `shot.yaml` |
| `./mangapipe grab DIR [--pose F] [--ref F]` | copy newest F11 renders from `UserData/cap` into the shot |
| `./mangapipe lora NAME [--series S] [--refresh]` | test the Civitai lookup only |
| `./mangapipe render DIR [--seed N] [--dry-run]` | ComfyUI render only (dry-run validates and writes the graph) |
| `./mangapipe compose DIR [--image F]` | overlay dialogue on `out/render_*.png` or a given image |
| `./mangapipe run DIR [--seed N] [--no-compose]` | everything |
| `./mangapipe page SCRIPT [--page N] [--pdf] [--out DIR]` | build manga pages from a script |
| `./mangapipe layouts [--ltr]` | contact sheet of the page templates with panel order |
| `./mangapipe export PROJECT webtoon\|cbz\|epub\|print [--colour mono\|grey\|colour]` | book formats from an editor project's exported pages |
| `./mangapipe poses build [--src DIR] [--out F]` | convert the studio pose files into `poses/library.json` |

| `./mangapipe pod create\|setup\|restart\|status\|url\|start\|stop\|remove\|ssh ["cmd"]` | RunPod pod lifecycle (`restart` relaunches ComfyUI after adding nodes) |

`mangapipe` is a zsh wrapper that uses the ComfyUI conda interpreter
(`/Users/deepratnaawale/miniconda3/envs/comfyui/bin/python`; override with `MANGAPIPE_PYTHON`).
`target: local` in `config.yaml` (or `MANGAPIPE_TARGET=local`) points everything at a ComfyUI on
this machine instead; `COMFYUI_URL=...` overrides the URL for any other server.

## The ComfyUI graph

Built in `mp/workflow.py` as API-format JSON and validated against the live server's
`/object_info` before queueing (missing models or nodes are listed instead of guessed):

```
CheckpointLoaderSimple  waiIllustriousSDXL_v160 (pod; HF mirror. Local install has v170)
  -> LoraLoader x N     (one per character with a resolved LoRA)
  -> CLIPTextEncode     positive = style + count tag + [trigger words | "Name \(series\)"] + tags + prompt
                        negative = style negative ("speech bubble, text" always in) + shot negative
ControlNetLoader        xinsir_controlnet_union-sdxl-1-promax  -> SetUnionControlNetType openpose
  -> ControlNetApplyAdvanced (strength 0.9, end 0.85, vae wired)
[identity ipadapter|reactor]  LoadImage reference -> PrepImageForClipVision(top crop)
  -> IPAdapterModelLoader ip-adapter-plus_sdxl_vit-h + CLIPVisionLoader clip_vision_h -> IPAdapterAdvanced
EmptyLatentImage (SDXL bucket) -> KSampler euler_ancestral 26 steps cfg 5.5 -> VAEDecode
[identity reactor]  ReActorFaceSwap(source = reference, inswapper_128, no restore)
SaveImage  output/MangaPipeline/<shot>/render_*.png
```

`mangapipe pod setup` (`mp/podsetup.py`) installs on the pod, over HTTP only: `ComfyUI_IPAdapter_plus`
through ComfyUI-Manager's install queue, then the checkpoint, the union ControlNet,
`ip-adapter-plus_sdxl_vit-h` and `clip_vision_h` through ComfyUI-RunpodDirect's download route
(all from Hugging Face, no login), then a Manager reboot. `remote/setup_pod.sh` does the same over
SSH if you prefer (`mangapipe pod ssh` prints the ssh command once RunPod reports the port; it took
a while on this host). The official image already ships ComfyUI-Manager, KJNodes, Civicomfy and RunpodDirect.
Not installed on the pod: ReActor (`identity: reactor` needs `comfyui-reactor` + insightface; install
it through ComfyUI-Manager on the pod's UI if you want it) and IPAdapter **FaceID** weights.

## Character identity

`mp/civitai.py` queries `https://civitai.com/api/v1/models?types=LORA&query=<name series>&baseModels=Illustrious,NoobAI,SDXL 1.0,Pony`.
Matching is whole-word on the model name, tags, version name and trained words ("Rem" does not
match "Remielle"); a short single name without a series hit is rejected as ambiguous. Base model is
ranked by `base_model_preference` in `config.yaml` (Illustrious first, matching the checkpoint).
The chosen file is downloaded **on the pod** (RunpodDirect route, ssh fallback) into
`/workspace/runpod-slim/ComfyUI/models/loras/civitai_characters/` on the network volume, so it
survives pod stop/remove; trigger words and provenance are kept in `cache/loras/<file>.json` here; the first trained word plus any that contain the character name are put
at the front of the prompt. Results are cached in `cache/lora_index.json` (`--refresh-lora` to redo).

**Civitai requires a login for downloads.** Set `CIVITAI_API_KEY` (API Keys in your Civitai
account settings) in the shell before running:

```bash
export CIVITAI_API_KEY=...
```

Without it the lookup still reports the match, logs `download-failed`, and `identity: auto`
falls back to IPAdapter with `reference.png`. `lora: <filename>` picks a file already under the
pod's `models/loras` (copy your own LoRAs there with FileBrowser on port 8080 or `runpodctl send`).

Override order per character: `lora: none` disables; `lora: file.safetensors` uses a local file;
`lora: https://civitai.com/models/123?modelVersionId=456` or `lora: 123` downloads that one;
`identity:` forces the path regardless of what resolved.

## Cost note

RTX 4090 secure cloud was $0.89/h at setup time; the 50 GB volume is a few dollars a month.
`pod stop` ends GPU billing. There is no auto-terminate timer in runpodctl 3.0.1, so stopping the
pod is on you. The pod `manga-comfy` (`nxebcceob8dulz`) was left **stopped** with the models on the
volume; `./mangapipe pod start` brings it back in about a minute (a stopped pod can lose its GPU
to another tenant; if `start` fails, `pod remove` then `pod create` on the same volume).

## First result

`shots/_example/out/final_12345_00.png`: pose followed exactly, identity from the reference
image (no Civitai key, so no LoRA), bubbles placed from the sidecar. 66 s on the 4090 including
model load. The first preset rendered pale, so `flat_anime` now asks for vivid colours and the
IPAdapter weight default dropped to 0.55; re-render with `--seed 12345` to compare.
