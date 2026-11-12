<script lang="ts">
  import { FORMAT_PRESETS, applyFormat, roman } from "../editor/book.ts";
  import { canvasSize } from "../core/format.ts";
  import { commit } from "../editor/history.js";
  import { refreshPanels, toast } from "../editor/misc.js";
  import { closeModal } from "../editor/modal.js";
  import { renderPages } from "../editor/pages.js";
  import { S } from "../editor/state.ts";
  import { FONTS, loadFontCss } from "../editor/text.js";
  import { fitView, requestDraw } from "../editor/view.js";
  import type { BookFormat, Numbering } from "../types.ts";

  const doc = S.doc!;
  let f: BookFormat = $state({ ...doc.format });
  let nb: Numbering = $state({ ...doc.numbering });
  const size = $derived(canvasSize(f));
  const resizes = $derived(size.w !== doc.width || size.h !== doc.height);
  const sample = $derived(nb.style === "roman" ? roman(nb.start) : String(nb.start));
  const fonts: string[] = FONTS.map((x: string[]) => x[0]);
  if (!fonts.includes(nb.font)) fonts.unshift(nb.font);

  function pick() {
    const p = FORMAT_PRESETS[f.preset ?? ""];
    if (p) { f.trimW = p.trimW; f.trimH = p.trimH; }
  }
  function apply() {
    if (!(f.trimW > 20 && f.trimH > 20 && f.dpi >= 72 && f.bleed >= 0 && f.safe >= 0 && (f.gutter ?? 0) >= 0)) return toast("Check the sizes: trim over 20 mm, dpi 72 or more", "err");
    if (resizes && !confirm(`The pages become ${size.w} × ${size.h} px and everything on them is scaled to fit. Continue?`)) return;
    const rescaled = applyFormat(doc, { ...f });
    doc.numbering = { ...nb };
    loadFontCss(nb.font).then(() => document.fonts.load(`20px "${nb.font}"`)).then(() => { requestDraw(); renderPages(); });
    commit("Book format"); closeModal();
    renderPages(); refreshPanels(); requestDraw();
    if (rescaled) fitView();
  }
</script>

<div class="mbody">
  <div class="form">
    <div class="section">Page size</div>
    <div class="row">
      <label for="bf-preset">Format</label>
      <select id="bf-preset" bind:value={f.preset} onchange={pick}>
        {#each Object.entries(FORMAT_PRESETS) as [key, p]}<option value={key}>{p.label}</option>{/each}
        <option value="custom">Custom</option>
      </select>
    </div>
    <div class="row">
      <label for="bf-w">Trim (mm)</label>
      <input id="bf-w" type="number" step="0.1" bind:value={f.trimW} oninput={() => (f.preset = "custom")} />
      <span class="hint">×</span>
      <input type="number" step="0.1" bind:value={f.trimH} oninput={() => (f.preset = "custom")} aria-label="Trim height" />
    </div>
    <div class="row">
      <label for="bf-bleed">Bleed (mm)</label><input id="bf-bleed" type="number" step="0.5" bind:value={f.bleed} />
      <span class="hint">safe</span><input type="number" step="0.5" bind:value={f.safe} aria-label="Safe margin" />
      <span class="hint">gutter</span><input type="number" step="0.5" bind:value={f.gutter} aria-label="Gutter" />
    </div>
    <div class="row">
      <label for="bf-dpi">Resolution</label><input id="bf-dpi" type="number" step="1" bind:value={f.dpi} />
      <span class="hint">dpi · page {size.w} × {size.h} px</span>
    </div>
    <p class="hint">Bleed is the art past the cut line, safe is how far inside the cut text and faces should stay, and gutter is the extra
      room on the bound edge and either side of a spread's fold.</p>
    <label class="chkrow">
      <input type="checkbox" bind:checked={f.exportBleed} />
      <span>Exports keep the bleed<br /><span class="hint">Off cuts exported pages to the trim, which suits screens, CBZ and EPUB.</span></span>
    </label>

    <div class="section">Page numbers</div>
    <label class="chkrow"><input type="checkbox" bind:checked={nb.show} /><span>Number the pages</span></label>
    <div class="row">
      <label for="bf-start">First page is</label>
      <input id="bf-start" type="number" step="1" bind:value={nb.start} />
      <select bind:value={nb.style} aria-label="Style"><option value="arabic">1, 2, 3</option><option value="roman">i, ii, iii</option></select>
      <span class="hint">shows "{sample}"</span>
    </div>
    <div class="row">
      <label for="bf-pos">Position</label>
      <select id="bf-pos" bind:value={nb.position}><option value="outer">Outer corner</option><option value="center">Centre</option><option value="inner">Inner corner</option></select>
      <select bind:value={nb.edge} aria-label="Edge"><option value="bottom">Bottom</option><option value="top">Top</option></select>
    </div>
    <div class="row">
      <label for="bf-off">Inset (mm)</label><input id="bf-off" type="number" step="0.5" bind:value={nb.offset} />
      <span class="hint">size</span><input type="number" step="0.5" bind:value={nb.size} aria-label="Size in mm" />
      <select bind:value={nb.font} aria-label="Font">{#each fonts as fo}<option value={fo}>{fo}</option>{/each}</select>
    </div>
    <p class="hint">Numbers count every page slot, spreads fill two, and are left off pages marked "No page number" (covers, title pages).</p>
  </div>
</div>
<div class="mfoot"><div class="spacer"></div><button onclick={closeModal}>Cancel</button><button class="primary" onclick={apply}>Apply</button></div>

<style>
  .hint { margin: 0; }
  p.hint { margin: 6px 0; }
  input[type="number"] { width: 72px; }
</style>
