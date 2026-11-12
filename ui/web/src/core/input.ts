/** One pen, mouse or touch sample in page px. */
export interface Sample {
  x: number; y: number;
  /** 0..1; mice report 0.5 while a button is down */
  pressure: number;
  tiltX: number; tiltY: number; twist: number;
  /** ms, from the event */
  t: number;
  pointerType: string;
}

export function samplesOf(e: PointerEvent, toPage: (sx: number, sy: number) => { x: number; y: number }, origin: { left: number; top: number }): Sample[] {
  const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
  return (list.length ? list : [e]).map(ev => {
    const p = toPage(ev.clientX - origin.left, ev.clientY - origin.top);
    return { x: p.x, y: p.y, pressure: ev.pressure || (ev.buttons ? 0.5 : 0), tiltX: ev.tiltX || 0, tiltY: ev.tiltY || 0, twist: ev.twist || 0, t: ev.timeStamp, pointerType: ev.pointerType };
  });
}

/** Smooths a stream of samples. push() returns the samples to use now (possibly none); flush() returns what is held back at pen-up. */
export interface Stabilizer { push(s: Sample): Sample[]; flush(): Sample[]; reset(): void }
export type StabilizerSpec = { kind: "none" } | { kind: "average"; window: number } | { kind: "rope"; length: number };

export function stabilizer(spec: StabilizerSpec): Stabilizer {
  if (spec.kind === "average") {
    let buf: Sample[] = [];
    return {
      push(s) { buf.push(s); if (buf.length > spec.window) buf.shift(); const n = buf.length; return [{ ...s, x: buf.reduce((a, q) => a + q.x, 0) / n, y: buf.reduce((a, q) => a + q.y, 0) / n }]; },
      flush() { const last = buf[buf.length - 1]; buf = []; return last ? [last] : []; },
      reset() { buf = []; },
    };
  }
  if (spec.kind === "rope") {
    let pos: Sample | null = null, last: Sample | null = null;
    return {
      push(s) {
        last = s;
        if (!pos) { pos = s; return [s]; }
        const dx = s.x - pos.x, dy = s.y - pos.y, d = Math.hypot(dx, dy);
        if (d <= spec.length) return [];
        const k = (d - spec.length) / d;
        pos = { ...s, x: pos.x + dx * k, y: pos.y + dy * k };
        return [pos];
      },
      flush() { const out = last && pos && (last.x !== pos.x || last.y !== pos.y) ? [last] : []; pos = last = null; return out; },
      reset() { pos = last = null; },
    };
  }
  return { push: s => [s], flush: () => [], reset() {} };
}

/** Maps raw pressure through a curve given as control points [[in, out], ...] from (0,0) to (1,1). */
export function pressureCurve(points: [number, number][]): (p: number) => number {
  const pts = [[0, 0] as [number, number], ...points, [1, 1] as [number, number]].sort((a, b) => a[0] - b[0]);
  return p => {
    p = Math.max(0, Math.min(1, p));
    for (let i = 1; i < pts.length; i++) if (p <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return x1 === x0 ? y1 : y0 + (y1 - y0) * (p - x0) / (x1 - x0);
    }
    return 1;
  };
}
