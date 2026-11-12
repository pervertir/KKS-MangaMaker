import type { Sample, StabilizerSpec } from "./input.ts";

export interface ToolEvent {
  /** samples since the last event, coalesced pen samples included, stabilized when the tool asks for it */
  samples: Sample[];
  /** the last sample, before stabilizing */
  raw: Sample;
  shift: boolean; alt: boolean; mod: boolean;
  button: number;
  native: PointerEvent;
}

/** A canvas tool. The editor routes pointer events, keys and overlay drawing to the active tool. */
export interface Tool {
  id: string;
  /** tooltip / cheat-sheet text */
  label: string;
  /** single-key shortcut (physical key, as in editor/tools.js SHORTCUTS) */
  key?: string;
  /** inline SVG for the toolbar */
  icon: string;
  /** toolbar group; tools of one group sit together after the built-in tools */
  group?: string;
  cursor?: string;
  stabilizer?: StabilizerSpec | (() => StabilizerSpec);
  activate?(): void;
  deactivate?(): void;
  down?(e: ToolEvent): void;
  move?(e: ToolEvent): void;
  up?(e: ToolEvent): void;
  /** pointer moves with no button down */
  hover?(e: ToolEvent): void;
  /** Escape or a lost pointer; drop whatever is in progress */
  cancel?(): void;
  /** return true when the key was used */
  keydown?(e: KeyboardEvent): boolean;
  /** draws on top of the page in page px; `px` is one screen pixel in page px */
  overlay?(ctx: CanvasRenderingContext2D, px: number): void;
  /** fills the options bar while the tool is active */
  options?(bar: HTMLElement): void;
}

const tools = new Map<string, Tool>();
const listeners = new Set<() => void>();
export function registerTool(t: Tool): Tool {
  tools.set(t.id, t);
  listeners.forEach(f => f());
  return t;
}
export const getTool = (id: string): Tool | undefined => tools.get(id);
export const registeredTools = (): Tool[] => [...tools.values()];
/** Called whenever a tool is added, so the toolbar and shortcut table can rebuild. */
export function onToolsChanged(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }
