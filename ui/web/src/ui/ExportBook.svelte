<script lang="ts">
  import { PREF } from "../editor/creation.js";
  import { closeModal } from "../editor/modal.js";
  import { exportBook } from "../editor/project.js";
  import { toast } from "../editor/misc.js";
  import { S } from "../editor/state.js";

  type Format = "webtoon" | "cbz" | "epub" | "print";
  const PRESETS: Record<string, { width: number; slice: number }> = {
    webtoon: { width: 800, slice: 1280 },
    custom: { width: 800, slice: 1280 },
  };

  const saved = (() => { try { return JSON.parse(PREF.get("exportBook", "{}")); } catch { return {}; } })();
  let picked = $state<Record<Format, boolean>>({ webtoon: false, cbz: true, epub: true, print: false, ...(saved.picked || {}) });
  let preset = $state<string>(saved.preset || "webtoon");
  let width = $state<number>(saved.width || 800);
  let slice = $state<number>(saved.slice || 1280);
  let gap = $state<number>(saved.gap ?? 80);
  let stripFmt = $state<string>(saved.stripFmt || "jpg");
  let cbzFmt = $state<string>(saved.cbzFmt || "png");
  let epubFmt = $state<string>(saved.epubFmt || "jpg");
  let colour = $state<string>(saved.colour || "mono");
  let busy = $state(false);
  let result = $state<{ files: string[]; warnings: string[] } | null>(null);

  $effect(() => {
    PREF.set("exportBook", JSON.stringify({ picked, preset, width, slice, gap, stripFmt, cbzFmt, epubFmt, colour }));
  });
  function usePreset() {
    if (preset !== "custom") ({ width, slice } = PRESETS[preset]);
  }
  const chosen = () => (Object.keys(picked) as Format[]).filter(k => picked[k]);

  async function run() {
    busy = true; result = null;
    try {
      result = await exportBook(chosen(), {
        webtoon: { width, slice_h: slice, gap, fmt: stripFmt },
        cbz: { fmt: cbzFmt },
        epub: { fmt: epubFmt },
        print: { colour },
      });
      if (result) toast(`Exported ${result.files.length} file${result.files.length === 1 ? "" : "s"}`, "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      busy = false;
    }
  }
  const short = (f: string) => f.split(/[\\/]export[\\/]/).pop();
</script>

<div class="mbody">
  <div class="form">
    <p class="hint">Renders every page, then builds the formats you tick into <b>pages/{S.name || "<project>"}/export/</b>.</p>

    <label class="chkrow">
      <input type="checkbox" bind:checked={picked.webtoon} />
      <span><b>Webtoon strip</b><br /><span class="hint">Panels restacked top to bottom in reading order, cut into slices between panels.</span></span>
    </label>
    {#if picked.webtoon}
      <div class="row">
        <label for="eb-preset">Size</label>
        <select id="eb-preset" bind:value={preset} onchange={usePreset}>
          <option value="webtoon">WEBTOON (800 wide, 1280 slices)</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div class="row">
        <label for="eb-width">Width</label>
        <input id="eb-width" type="number" min="320" max="2000" step="10" bind:value={width} oninput={() => (preset = "custom")} />
        <label for="eb-slice">Slice height</label>
        <input id="eb-slice" type="number" min="400" max="20000" step="10" bind:value={slice} oninput={() => (preset = "custom")} />
      </div>
      <div class="row">
        <label for="eb-gap">Gap</label>
        <input id="eb-gap" type="number" min="0" max="1000" step="10" bind:value={gap} />
        <label for="eb-sfmt">Format</label>
        <select id="eb-sfmt" bind:value={stripFmt}><option value="jpg">JPEG</option><option value="png">PNG</option></select>
      </div>
    {/if}

    <label class="chkrow">
      <input type="checkbox" bind:checked={picked.cbz} />
      <span><b>CBZ</b><br /><span class="hint">Comic archive with ComicInfo.xml (title, reading direction, cover, spreads, chapters).</span></span>
    </label>
    {#if picked.cbz}
      <div class="row">
        <label for="eb-cfmt">Images</label>
        <select id="eb-cfmt" bind:value={cbzFmt}><option value="png">PNG (lossless)</option><option value="jpg">JPEG (smaller)</option></select>
      </div>
    {/if}

    <label class="chkrow">
      <input type="checkbox" bind:checked={picked.epub} />
      <span><b>EPUB</b><br /><span class="hint">Fixed-layout EPUB 3 for e-readers: one image per page, facing pages, chapters in the contents.</span></span>
    </label>
    {#if picked.epub}
      <div class="row">
        <label for="eb-efmt">Images</label>
        <select id="eb-efmt" bind:value={epubFmt}><option value="jpg">JPEG (smaller)</option><option value="png">PNG (lossless)</option></select>
      </div>
    {/if}

    <label class="chkrow">
      <input type="checkbox" bind:checked={picked.print} />
      <span><b>Print PDF</b><br /><span class="hint">Pages with bleed, trim and bleed boxes for a print shop.</span></span>
    </label>
    {#if picked.print}
      <div class="row">
        <label for="eb-colour">Colour</label>
        <select id="eb-colour" bind:value={colour}>
          <option value="mono">Black and white (1-bit, 600 dpi)</option>
          <option value="grey">Greyscale</option>
          <option value="colour">Colour (CMYK, black on K only)</option>
        </select>
      </div>
    {/if}

    {#if result}
      <div class="section">Written</div>
      {#each result.files as f}<div class="hint">{short(f)}</div>{/each}
      {#each result.warnings as w}<p class="hint warn">⚠ {w}</p>{/each}
    {/if}
  </div>
</div>
<div class="mfoot">
  <div class="spacer"></div>
  <button onclick={closeModal}>Close</button>
  <button class="primary" disabled={busy || !chosen().length} onclick={run}>{busy ? "Exporting…" : "Export"}</button>
</div>
