/* Read by the Vite plugin and by svelte-check. */
const QUIET = new Set([
  // rows and tiles are picked with the mouse; the keyboard works on the selection (Delete, arrows, shortcuts)
  "a11y_click_events_have_key_events", "a11y_no_static_element_interactions", "a11y_no_noninteractive_element_interactions",
  "a11y_no_noninteractive_tabindex", "a11y_interactive_supports_focus",
  // a row is "<label>name</label> control": the label is a caption, laid out by the shared .row rule
  "a11y_label_has_associated_control",
]);
export default { compilerOptions: { warningFilter: w => !QUIET.has(w.code) } };
