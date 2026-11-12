/* State the Svelte components draw from. The editor's own state (S, the document, undo) stays in
   src/editor/state.js; modules copy into `ui` what a component needs to show, and components call
   back into the modules to act. */
export const ui = $state({
  jobsOpen: false,
  jobs: [],          // [{id, label, state: "run" | "ok" | "bad"}], newest first
  jobView: null,
  jobLog: "",
  toasts: [],        // [{id, text, kind}]
  rev: 0,            // bumped whenever the document, the selection or a shot changes: lists re-read the editor state
  dockTab: "panels", // layers | panels | library
});
