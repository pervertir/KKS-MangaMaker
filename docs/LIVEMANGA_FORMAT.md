# Live Manga format 1.0

A portable format for manga pages whose characters move. A reader site needs only this bundle and a
player, which can be [`livemanga.js`](../ui/web/public/livemanga.js): one dependency-free file. No pose
library, no image model and no server-side code is needed to show the pages.

Design rules:

* **Every page degrades to a picture.** `base` is the finished still page, so a site that ignores the
  motion, or a reader with reduced motion turned on, still gets the complete manga.
* **Lettering is never animated or re-drawn.** Speech bubbles, captions, SFX and panel borders live in
  a transparent `overlay` that is laid over the moving panels.
* **Motion is baked.** Each character carries its skeleton for every frame, so a player only looks up
  a frame and warps an image. How the poses were made (OpenPose keyframes, game animation clips,
  hand-drawn) does not matter to the player.

## Bundle

A folder, or the same folder zipped with the extension `.livemanga`:

```
manga.json                      the manifest (below)
pages/01/base.png               the still page, everything drawn
pages/01/overlay.png            transparent: borders, bubbles, text, effects that sit above the panels
panels/<panel id>/bg.png        a moving panel's background, with no characters
panels/<panel id>/actor_1.png   one character, cut out (transparent outside the figure)
index.html, livemanga.js        optional: a ready reader for static hosting
```

Paths in the manifest are relative to `manga.json`. Images may be PNG or WebP; actors need alpha.
Serve the bundle over HTTP (any static host). Actor images on another origin need CORS headers,
because a player reads their pixels to build the mesh.

MangaMaker writes a bundle with **Export .livemanga** in the Live bar: `pages/<project>/<project>.livemanga`
(zip) and the same files unzipped in `pages/<project>/<project>_livemanga/`, ready to upload.

## manifest (`manga.json`)

```json
{
  "format": "livemanga",
  "version": "1.0",
  "title": "Chapter 1",
  "reading": "rtl",
  "page": { "width": 1800, "height": 2700 },
  "pages": [
    {
      "base": "pages/01/base.png",
      "overlay": "pages/01/overlay.png",
      "panels": [
        {
          "id": "x27mmrv7",
          "clip": [64, 64, 1672, 673],
          "art": { "width": 1344, "height": 768, "rect": [64, -126, 1672, 955], "flip": false },
          "fps": 12,
          "loop": "loop",
          "background": "panels/x27mmrv7/bg.png",
          "actors": [
            {
              "image": "panels/x27mmrv7/actor_1.png",
              "bind": [[672, 210], [672, 260], "... 18 points"],
              "frames": [[[672, 210], "... 18 points"], "... one entry per frame"]
            }
          ]
        }
      ]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `reading` | `rtl` (manga, right to left) or `ltr`; only matters for page turning |
| `page` | page size in page pixels; every page coordinate below uses it |
| `pages[].base` | the complete still page (required) |
| `pages[].overlay` | transparent image of what sits above the panels; drawn last (optional) |
| `panels[].clip` | `[x, y, w, h]` in page pixels: the panel window; nothing of the panel draws outside it |
| `panels[].art` | the panel's artwork space: `width`/`height` in art pixels, `rect` = where that whole artwork lands on the page (`[x, y, w, h]`, may reach past `clip`), `flip` = mirrored horizontally |
| `panels[].fps`, `loop` | frame rate; `loop` repeats the frames, `once` plays them and holds the last |
| `panels[].background` | image of `art` size drawn first |
| `actors[]` | drawn in order, back to front |
| `actors[].image` | the cut-out character, `art` size, standing where its `bind` skeleton is |
| `actors[].bind` | the skeleton the image was drawn in: 18 `[x, y]` points in art pixels |
| `actors[].frames` | the skeleton for each frame, same layout; the panel has as many frames as its longest actor |

Skeleton points are COCO-18 in this order: nose, neck, right shoulder, right elbow, right wrist, left
shoulder, left elbow, left wrist, right hip, right knee, right ankle, left hip, left knee, left ankle,
right eye, left eye, right ear, left ear. A point may be `null` when it does not exist.

## Drawing a frame

For page `p` at time `t` seconds:

1. Draw `base`.
2. For each panel: frame `n = floor(t * fps)`, wrapped (`loop`) or clamped (`once`) to the frame
   count. Clip to `clip`, map art pixels onto `art.rect` (mirrored if `flip`), draw `background`,
   then each actor's `image` deformed so that its `bind` skeleton moves onto `frames[n]`.
3. Draw `overlay`.

The deformation is up to the player. The reference player binds a triangle mesh over the opaque part
of the image to these bones:

```
neck-nose, neck-r.shoulder, r.shoulder-r.elbow, r.elbow-r.wrist, neck-l.shoulder, l.shoulder-l.elbow,
l.elbow-l.wrist, neck-r.hip, r.hip-r.knee, r.knee-r.ankle, neck-l.hip, l.hip-l.knee, l.knee-l.ankle,
r.hip-l.hip
```

Each mesh vertex follows its three nearest bones (weights 1 / (distance + c)^4). Each bone moves its
vertices with the map that turns the bound bone onto the posed bone and stretches along its length only.

A player should pause panels that are off screen, and show `base` alone when the reader asks for
reduced motion.

## Security

A manifest is untrusted input; a player must not let one reach beyond its own bundle.

* **Paths** are relative to `manga.json`, use only `A-Z a-z 0-9 _ . / -`, and have no empty, `.` or
  `..` segments. No URLs, schemes or leading slashes. A resolved asset must stay in the manifest's
  folder on the same origin.
* **Numbers** are checked for type and range before use (page sides up to 8192, art up to 4096,
  at most 32 panels a page, 16 actors a panel, 1440 frames, fps 1 to 60, manifest up to 16 MB).
  Nothing from the manifest is written into HTML or CSS as text; the title only ever goes in as text.
* **Images** load with `crossOrigin="anonymous"` and `referrerPolicy="no-referrer"`, and are refused
  above 4096 x 6144 pixels.
* The bundle's `index.html` has no inline script and a Content Security Policy that allows only the
  bundle's own files.
* MangaMaker re-encodes every image it exports, so no render metadata (prompts, workflows, model
  names, file paths) is published.

`livemanga.js` does all of this; `LiveManga.validate(json)` gives other players the same check.

## Using the reference player

```html
<div id="reader"></div>
<script src="livemanga.js"></script>
<script>LiveManga.reader(document.getElementById("reader"), "chapter1/manga.json");</script>
```

`LiveManga.reader(el, url)` shows one page at a time (arrow keys, click or swipe to turn, in reading
order). `LiveManga.page(canvas, manifest, pageIndex, baseUrl)` draws and plays one page in a canvas
you own and returns `{ stop() }`.
