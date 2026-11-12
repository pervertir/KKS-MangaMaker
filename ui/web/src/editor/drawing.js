import { clamp } from "./core.js";
import { THEMES, themeOf, themed, paperOf } from "./creation.js";
import { imgFor } from "./images.js";
import { drawFlipped, drawVBubble, lum, speedCanvas, toneCanvas } from "./manga-tools.js";
import { S, bubbleMeta, page } from "./state.js";
import { drawText } from "./text.js";
import { clipToPanel, strokePanel } from "./frames.js";


/* ================================================================ drawing */
export function imageRect(l, im) {
  const I = l.image, iw = I.iw || im?.naturalWidth || 1, ih = I.ih || im?.naturalHeight || 1;
  if (I.fit === "contain") {
    const s = Math.min(l.w / iw, l.h / ih) * (I.zoom || 1);
    return { x: l.x + (l.w - iw * s) / 2, y: l.y + (l.h - ih * s) / 2, w: iw * s, h: ih * s, s };
  }
  const s = Math.max(l.w / iw, l.h / ih) * Math.max(1, I.zoom || 1);
  const sw = iw * s, sh = ih * s;
  const fx = I.focus?.[0] ?? 0.5, fy = I.focus?.[1] ?? 0.5;
  const x0 = clamp(fx * sw - l.w / 2, 0, sw - l.w), y0 = clamp(fy * sh - l.h / 2, 0, sh - l.h);
  return { x: l.x - x0, y: l.y - y0, w: sw, h: sh, s };
}
export function withBox(ctx, l, fn) {
  ctx.save();
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  ctx.translate(cx, cy);
  if (l.rotate) ctx.rotate(l.rotate * Math.PI / 180);
  fn(cx, cy);
  ctx.restore();
}
export function drawLayer(ctx, l, opt = {}) {
  if (!l.visible) return;
  const TH = themeOf(opt); l = themed(l, TH);
  ctx.save();
  ctx.globalAlpha = l.opacity ?? 1;
  ctx.globalCompositeOperation = l.blend || "source-over";
  const maxFont = S.doc.maxFont || 56;
  switch (l.type) {
    case "panel": {
      if (l.gap > 0) strokePanel(ctx, { ...l, border: 0, gap: l.gap + Math.max(0, l.border) }, opt.paper || paperOf(page(), opt));   // the gap first, so a neighbour's art under an inset is cut back
      ctx.save(); clipToPanel(ctx, l);
      ctx.fillStyle = l.fill || "#fff";
      ctx.fillRect(l.x, l.y, l.w, l.h);
      const r0 = l.image ? imageRect(l) : null;
      const im = l.image ? imgFor(l.image.ref, r0.w * (opt.rs || 1)) : null;
      if (l.image && im) {
        const r = r0;
        if (opt.ghost) { ctx.restore(); ctx.save(); ctx.globalAlpha = 0.3; drawFlipped(ctx, im, r, l.image.flip); ctx.restore(); ctx.save(); clipToPanel(ctx, l); }
        ctx.save();
        if (l.image.gray) ctx.filter = "grayscale(1) contrast(1.18)";
        drawFlipped(ctx, im, r, l.image.flip);
        ctx.restore();
      } else if (!opt.export) {
        const E = THEMES[lum(l.fill || "#fff") < 0.4 ? "dark" : "light"].empty;      // follows the panel's own fill
        ctx.fillStyle = E[0]; ctx.fillRect(l.x, l.y, l.w, l.h);
        ctx.strokeStyle = E[1]; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(l.x + l.w, l.y + l.h); ctx.moveTo(l.x + l.w, l.y); ctx.lineTo(l.x, l.y + l.h); ctx.stroke();
        ctx.fillStyle = "#8a8a93"; ctx.font = `600 ${clamp(Math.min(l.w, l.h) / 9, 18, 54)}px -apple-system, sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(l.shot ? `${l.shot} (no render)` : "drop a render here", l.x + l.w / 2, l.y + l.h / 2);
      }
      ctx.restore();
      strokePanel(ctx, { ...l, gap: 0 }, null);
      break;
    }
    case "bubble": {
      const m = bubbleMeta(l.bubble);
      const im = imgFor(m.ref, l.w * (opt.rs || 1));
      withBox(ctx, l, () => {
        if (im) {
          ctx.save(); if (l.flip) ctx.scale(-1, 1);
          ctx.drawImage(im, -l.w / 2, -l.h / 2, l.w, l.h);
          ctx.restore();
        } else { ctx.strokeStyle = "#999"; ctx.strokeRect(-l.w / 2, -l.h / 2, l.w, l.h); }
        let [bx0, by0, bx1, by1] = m.box;
        if (l.flip) [bx0, bx1] = [1 - bx1, 1 - bx0];
        const tx = -l.w / 2 + (bx0 + bx1) / 2 * l.w, ty = -l.h / 2 + (by0 + by1) / 2 * l.h;
        const tw = (bx1 - bx0) * l.w * 0.92, th = (by1 - by0) * l.h * 0.88;
        const col = l.color === "auto" ? (m.dark ? "#ffffff" : "#111111") : l.color;
        ctx.globalCompositeOperation = "source-over";
        drawText(ctx, { ...l, strokeWidth: 0 }, tx, ty, tw, th, maxFont, col);
      });
      break;
    }
    case "caption": {
      withBox(ctx, l, () => {
        ctx.fillStyle = l.fill || "#fff"; ctx.fillRect(-l.w / 2, -l.h / 2, l.w, l.h);
        if (l.borderW > 0) { ctx.strokeStyle = lum(l.fill || "#fff") < 0.45 ? "#fff" : "#000"; ctx.lineWidth = l.borderW; ctx.strokeRect(-l.w / 2, -l.h / 2, l.w, l.h); }
        const pad = Math.min(l.w, l.h) * 0.12 + 6;
        drawText(ctx, { ...l, strokeWidth: 0 }, 0, 0, l.w - pad * 2, l.h - pad * 2, maxFont, l.color === "auto" ? (lum(l.fill || "#fff") < 0.45 ? "#ffffff" : "#111") : l.color);
      });
      break;
    }
    case "text": {
      withBox(ctx, l, () => {
        const big = l.fontSize > 0 ? l.fontSize : Math.max(maxFont, 400);
        drawText(ctx, l, 0, 0, l.w, l.h, big, l.color === "auto" ? THEMES[TH].ink : l.color);
      });
      break;
    }
    case "vbubble": {
      withBox(ctx, l, () => drawVBubble(ctx, l, maxFont));
      break;
    }
    case "tone":
    case "speed": {
      const clip = l.clip && S.doc.pages.flatMap(p => p.layers).find(q => q.id === l.clip);
      if (clip) clipToPanel(ctx, clip);
      const art = l.type === "tone" ? toneCanvas(l) : speedCanvas(l);
      withBox(ctx, l, () => ctx.drawImage(art, -l.w / 2, -l.h / 2, l.w, l.h));
      break;
    }
    case "image": {
      const im = imgFor(l.ref, l.w * (opt.rs || 1));
      withBox(ctx, l, () => {
        if (!im) return;
        ctx.save(); if (l.flip) ctx.scale(-1, 1);
        ctx.drawImage(im, -l.w / 2, -l.h / 2, l.w, l.h);
        ctx.restore();
      });
      break;
    }
  }
  ctx.restore();
}
