<script lang="ts">
  import { PREF, applyThemeChrome, displayTheme, exportPaper } from "../editor/creation.js";
  import { THUMBS } from "../editor/layers.js";
  import { renderLibrary } from "../editor/library.js";
  import { refreshPanels } from "../editor/misc.js";
  import { closeModal } from "../editor/modal.js";
  import { renderPages } from "../editor/pages.js";
  import { S } from "../editor/state.ts";
  import { requestDraw } from "../editor/view.js";
  import { TIPS_ON, toggleTips } from "../helpers/tips.js";

  let dark = $state(displayTheme() === "dark");
  let exportPages = $state(PREF.get("exportTheme", "light"));
  let custom = $state(!!exportPaper());
  let paper = $state(exportPaper() || "#ffffff");
  let tips = $state(TIPS_ON());

  // every setting applies as it changes: there is nothing to confirm
  function setDark() {
    PREF.set("darkPages", dark ? "1" : "0");
    applyThemeChrome(); THUMBS.clear(); requestDraw(); refreshPanels(); renderPages();
    if (S.libTab === "layouts") renderLibrary();
  }
  $effect(() => { PREF.set("exportTheme", exportPages); });
  $effect(() => { PREF.set("exportPaper", custom ? paper : null); });
</script>

<div class="mbody">
  <div class="form">
    <div class="section">Pages</div>
    <label class="chkrow">
      <input type="checkbox" bind:checked={dark} onchange={setDark} />
      <span><b>Dark pages</b><br /><span class="hint">Black paper, white panel frames and white lettering everywhere in the editor: every page,
        thumbnails, the book overview and layouts. Bubbles stay white, and colours you chose yourself are kept.</span></span>
    </label>

    <div class="section">Export (PNG, PDF, download)</div>
    <div class="row">
      <label for="pref-export">Pages</label>
      <select id="pref-export" bind:value={exportPages}>
        <option value="light">White pages (default)</option>
        <option value="dark">Dark pages</option>
        <option value="screen">Same as on screen</option>
      </select>
    </div>
    <div class="row">
      <label for="pref-paper">Paper</label>
      <label class="hint inline"><input type="checkbox" bind:checked={custom} /> custom colour</label>
      <input id="pref-paper" type="color" bind:value={paper} disabled={!custom} />
    </div>
    <p class="hint">Exports use white pages unless you change this, whatever the editor shows. A custom paper colour replaces the page
      background in exports only.</p>

    <div class="section">Help</div>
    <label class="chkrow">
      <input type="checkbox" bind:checked={tips} onchange={toggleTips} />
      <span>Show a tip for the active tool</span>
    </label>
  </div>
</div>
<div class="mfoot"><div class="spacer"></div><button class="primary" onclick={closeModal}>Done</button></div>

<style>
  .hint { margin: 0; }
  p.hint { margin: 6px 0; }
  .inline { display: flex; gap: 6px; align-items: center; }
</style>
