import type { Region } from "../core/geometry/region.ts";
import { dilate, maskToRegion, type Mask } from "../core/raster.ts";

/* Fill bucket: flood the composited page from the clicked pixel, closing gaps in the line art first,
   and return the area as a region, so the fill stays sharp at any export size. */

/* scanline flood over everything that is not a wall */
function flood(wall: Uint8Array, w: number, h: number, sx: number, sy: number): Uint8Array {
  const reg = new Uint8Array(w * h), stack = [sx, sy];
  const open = (x: number, y: number) => !wall[y * w + x] && !reg[y * w + x];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    while (x >= 0 && open(x, y)) x--;
    x++;
    let up = false, dn = false;
    for (; x < w && open(x, y); x++) {
      reg[y * w + x] = 1;
      if (y > 0) { const o = open(x, y - 1); if (o && !up) stack.push(x, y - 1); up = o; }
      if (y < h - 1) { const o = open(x, y + 1); if (o && !dn) stack.push(x, y + 1); dn = o; }
    }
  }
  return reg;
}

/**
 * img: the composited page at `s` image px per page px. (px, py): the click in page px.
 * gap: page px of line-art gap to close. tolerance: 0..255 colour difference that still counts as the same area.
 * Returns the area in page px (even-odd rings); empty when nothing could be filled.
 */
export function regionAt(img: ImageData, s: number, px: number, py: number, gap: number, tolerance: number): Region {
  const { width: w, height: h, data: d } = img;
  const sx = Math.min(w - 1, Math.max(0, Math.round(px * s))), sy = Math.min(h - 1, Math.max(0, Math.round(py * s)));
  const o = (sy * w + sx) * 4, r0 = d[o], g0 = d[o + 1], b0 = d[o + 2];
  const wall: Mask = { w, h, data: new Uint8Array(w * h) };
  for (let i = 0, j = 0; i < w * h; i++, j += 4)
    wall.data[i] = Math.max(Math.abs(d[j] - r0), Math.abs(d[j + 1] - g0), Math.abs(d[j + 2] - b0)) > tolerance ? 1 : 0;
  const gr = Math.round(gap * s);
  let closed = dilate(wall, gr);
  if (closed.data[sy * w + sx]) closed = wall;
  const reg: Mask = { w, h, data: flood(closed.data, w, h, sx, sy) };
  // grow back under the lines it stopped short of, plus a pixel so no paper shows along anti-aliased edges
  return maskToRegion(dilate(reg, (closed === wall ? 0 : gr) + 1), 1 / s);
}
