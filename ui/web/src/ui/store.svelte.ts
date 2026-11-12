import type { DockTab, JobChip, Toast } from "../types.ts";

/* State the Svelte components draw from. The editor's own state (S, the document, undo) stays in
   src/editor/state.ts; modules copy into `ui` what a component needs to show, and components call
   back into the modules to act. */
interface UiState {
  jobsOpen: boolean;
  /** newest first */
  jobs: JobChip[];
  jobView: string | null;
  jobLog: string;
  toasts: Toast[];
  /** bumped whenever the document, the selection or a shot changes: components re-read the editor state */
  rev: number;
  dockTab: DockTab;
}
export const ui: UiState = $state({ jobsOpen: false, jobs: [], jobView: null, jobLog: "", toasts: [], rev: 0, dockTab: "panels" });
