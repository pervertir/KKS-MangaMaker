# Live Manga

Panels whose characters move. The background is rendered once with nobody in it, each character is
rendered on its own and cut out, and the editor moves every cutout along OpenPose keyframes. Bubbles,
captions and effects stay ordinary page layers on top. Nothing is rendered per frame.

Live Manga is off until you switch it on: **✦ Live Manga** in the menu bar (saved in the project as
`"live": true`). Normal pages are unchanged.

## Making a panel move

1. Pose the panel in the Pose tab (Pipeline › Pose the selected panel) and render it as usual. The
   panel's still is what print and PNG/PDF export use.
2. Switch on **✦ Live Manga**, select the panel, click **Make panel live** in the Live bar.
3. Double-click the timeline to add a keyframe. The Pose tab opens on that moment; pose the
   characters and press ⌘S (Save) to keep the key. Right-click a key to delete it. The 0 s key is the
   pose the panel was rendered in.
4. Type a background prompt that describes the place with nobody in it, then **Render layers**. On
   the pod this renders the background and one cutout per character into `shots/<shot>/live/`.
5. **▶ Play** plays every live panel on the page. Drag on a timeline to scrub one.

Before the layers are rendered, a live panel previews its skeletons moving over the still.

6. **Export .livemanga** writes the chapter in the open [Live Manga format](LIVEMANGA_FORMAT.md):
   page stills, a lettering overlay, the panel layers and every frame's skeleton, plus a reader
   page and `livemanga.js`, so any website can show the chapter with the panels moving.

## How the motion works

* Keyframe poses blend joint by joint: each bone turns from one pose to the next and keeps its
  length, so limbs do not shrink halfway. Position, size, turn (yaw/pitch/roll) and joint edits ease
  in between.
* Each cutout is bound to the skeleton it was rendered in with a triangle mesh; every mesh point
  follows its nearest bones. Playing a frame moves the mesh onto the blended skeleton.
* This suits acting within a pose family: waving, turning the head, leaning, shifting weight, small
  steps. A big change that reveals a hidden side (turning round, an arm coming from behind the body)
  needs its own render; re-pose the 0 s key and render the layers again.

## Saved format

`pages/<project>/project.json` is the chapter file (version 2). Every panel tied to a shot carries the
shot's `scene` (prompt, seed, characters, Pose tab skeletons; see `mp/chapter.py`), and a live panel adds:

```json
"live": {
  "duration": 2, "fps": 12, "loop": "pingpong",
  "bgPrompt": "empty classroom at sunset",
  "bg": { "ref": "mp:shots/ch1_p01_1/live/bg_3726344714.png" },
  "actors": [ { "id": "2m8qqtze", "ref": "mp:shots/ch1_p01_1/live/actor_2m8qqtze_3726344714.png" } ],
  "keys": [ { "t": 1.0, "chars": [ { "id": "2m8qqtze", "pose": "basic/Waving", "x": 0.55, "y": 0.92,
                                    "scale": 0.85, "yaw": 20, "pitch": 0, "roll": 0, "flip": false, "edits": {} } ] } ]
}
```

| Key | Meaning |
| --- | --- |
| `duration`, `fps` | loop length in seconds (0.5 to 8) and frame rate (4 to 24; anime sits at 8 to 12) |
| `loop` | `pingpong` (there and back, no seam), `loop`, or `once` |
| `bg`, `actors` | the rendered layers; actors are matched to Pose tab characters by `id` |
| `keys` | poses after 0 s; a character missing from a key holds its earlier pose |

## Command line

```bash
./mangapipe live shots/<shot> [--char bg] [--char <id>] [--bg-prompt "..."]   # render the layers
./mangapipe chapter status <project>    # which panels need a render
./mangapipe chapter render <project>    # re-render changed panels from the JSON
./mangapipe chapter sync <project>      # pull edits made in shot folders into the JSON
```
