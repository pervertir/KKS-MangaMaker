# Capture -> render -> page: the fast path for adult comics

Scope: adult characters only (see `docker/README.md`).

## What the ControlNet zipmod actually gives you

`mods/MyMods/[xukmi][KKS] ControlNet Shaders v1.1.zipmod` (`xukmi.Shaders.ControlNetShaders`) contains,
from its manifest and list files:

| part | where in the game | what it does |
|---|---|---|
| **OpenPose Rig** (bra slot, id 81682825, asset `openposeskelehands`) | Character > clothing, Bra | an OpenPose skeleton *with hands* worn by any character; the OpenPose Adjusted card is just a body wearing this |
| **OpenPose Overlay** (Studio item 303) | Studio > Add > Item > xukmi > Control Net | screen effect: draws OpenPose bones for everyone in view |
| **Depth** (Studio item 301) | same group | screen effect: the camera view as a depth map (`DepthDist`, `DepthAdjust` in Material Editor) |
| **Canny Edge** (Studio item 302) | same group | screen effect: the view as canny edges (`Blur`, thresholds) |
| shaders `xukmi/OpenPoseBones(AlphaClip)`, `xukmi/Effects/Depth`, `xukmi/Effects/CannyEdge` | Material Editor | tunables above, plus `NodeSize`, `BoneSize`, `Opacity` for the bones |

The item behaviour is read from the zipmod's files; I have not toggled them in Studio yet, so the
first real session should confirm each one renders as described.

What it changes: **no more swapping characters to the OpenPose card.** You keep the real characters
in the scene and toggle effect items, so two or more characters, contact and the exact camera all
come for free, and one scene yields every control map.

## Per shot in Studio (about 30 seconds)

1. Pose the characters, frame the camera, then leave the camera alone. Save the scene (Studio
   scene PNG) so you can re-capture later.
2. **F11** with everything normal -> `reference.png` (colours, outfits, identity).
3. Show the **Depth** item -> **F11** -> hide it -> `depth.png`.
4. Show the **OpenPose Overlay** item -> **F11** -> hide it -> `pose.png`.
   (Canny is optional; it copies Koikatsu's proportions and face shapes too literally for anime output.)

Keep the three items in one Studio folder so toggling is one click each.

## Why depth + pose for adult scenes

OpenPose alone fails as soon as bodies overlap: interlocked limbs get assigned to the wrong
person, occluded joints vanish, and the model invents anatomy. Depth carries the body volumes and
where they touch, which is exactly what intercourse and close-contact panels need. The union
ControlNet already on the pod (xinsir promax) does both types from one model file.

Starting values (to tune on the pod, not yet measured):

| control | strength | end |
|---|---|---|
| openpose | 0.7 | 0.6 |
| depth | 0.5 | 0.5 |

## Identity and act LoRAs

- One adult character LoRA per character at 0.6 to 0.8 (bundled ones resolve automatically by name).
- One act/position LoRA at 0.5 to 0.7 only when the base model gets the position wrong; WAI
  Illustrious already knows most booru position tags.
- More than three LoRAs stacked degrades faces. For two named characters in one panel, keep both
  character LoRAs near 0.6 and lean on the prompt order (`2girls` / `1boy, 1girl`) and the reference.

## Rendering for speed

1. Draft: 4 seeds per shot at the SDXL bucket nearest the capture, 20 steps.
2. Pick the best, re-render only that one at 26 to 30 steps (or upscale it 1.5x).
3. Optional img2img from `reference.png` at denoise 0.55 to 0.65 with depth control: keeps
   Koikatsu's outfits and colours and converges faster; lower denoise lets the pastel 3D look through.

On the 4090 a warm SDXL render at 26 steps should be roughly 10 seconds; the 66 s measured so far
included model loading. Treat that as an estimate until a batch is timed.

## Page assembly

Unchanged: `mangapipe page scripts/<chapter>.yaml --pdf` lays the picked renders into your
Comic Strips templates (manga order) with bubbles composited on top; the model never draws text.

## What the pipeline still needs for this (not built yet)

- `grab` that takes the last three F11 files as reference / depth / pose;
- a second ControlNet (depth) in `mp/workflow.py`, with `controlnets:` per shot;
- a shot-level `loras:` list for act LoRAs (today LoRAs only attach to characters);
- an img2img mode from `reference.png`;
- `--seeds N` drafts plus a "promote" step.
