<script lang="ts">
  /* Layers tab: everything except the frames, front to back. A run of panels is one marker row, so the
     stack stays truthful (a tone can sit over or under the frames) while the frames live in the Panels tab. */
  import { tick } from "svelte";
  import { ui } from "./store.svelte.ts";
  import { node } from "./mount.ts";
  import { setDockTab } from "../editor/dock-tabs.js";
  import { commit } from "../editor/history.js";
  import { layerMenu, layerName, layerThumb, svgIcon } from "../editor/layers.js";
  import { popMenu } from "../editor/menus.js";
  import { refreshPanels } from "../editor/misc.js";
  import type { Layer } from "../types.ts";
  import { S, layers } from "../editor/state.ts";
  import { deleteSelected } from "../editor/tools.js";
  import { requestDraw } from "../editor/view.js";

  /* a layer, or the marker that stands for a run of panel frames */
  type Row = { key: string; on: boolean; l?: Layer; name?: string; visible?: boolean; locked?: boolean; thumb?: HTMLElement; run?: Layer[] };
  // rows are rebuilt from the document on every change (ui.rev): the layers themselves are plain objects
  const rows = $derived.by(() => {
    ui.rev;
    if (!S.doc) return [];
    const rev = [...layers()].reverse(), out: Row[] = [];
    for (let i = 0; i < rev.length; i++) {
      const l = rev[i];
      if (l.type !== "panel") {
        out.push({ key: l.id, l, on: l.id === S.sel, name: layerName(l), visible: l.visible, locked: l.locked, thumb: layerThumb(l) });
        continue;
      }
      let j = i; while (j + 1 < rev.length && rev[j + 1].type === "panel") j++;
      const run = rev.slice(i, j + 1);                       // run[0] is the frontmost frame of the run
      out.push({ key: "run:" + run[0].id, run, on: run.some(q => q.id === S.sel) });
      i = j;
    }
    return out;
  });
  const empty = $derived(!rows.some(r => r.l));

  let box = $state<HTMLElement>(), over = $state<string | null>(null), lastSel: string | null = null;
  // bring the picked row into view only when the pick changes, never on every redraw
  $effect(() => {
    ui.rev;
    if (S.sel === lastSel) return;
    lastSel = S.sel;
    tick().then(() => box?.querySelector(".on")?.scrollIntoView({ block: "nearest" }));
  });

  const pick = (l: Layer) => { S.sel = l.id; refreshPanels(); requestDraw(); };
  function rename(l: Layer) { const n = prompt("Layer name", layerName(l)); if (n != null) { l.name = n; commit(); } }
  function menu(e: MouseEvent, l: Layer) { e.preventDefault(); pick(l); popMenu(e.clientX, e.clientY, layerMenu()); }
  /* drop a dragged layer just above `target` in the stack */
  function drop(e: DragEvent, target: Layer) {
    e.preventDefault(); over = null;
    const ls = layers(), src = ls.find(q => q.id === e.dataTransfer!.getData("text/layer"));
    if (!src || src === target) return;
    ls.splice(ls.indexOf(src), 1); ls.splice(ls.indexOf(target) + 1, 0, src);
    commit("Reordered"); requestDraw();
  }
  const quiet = (fn: () => void) => (e: Event) => { e.stopPropagation(); fn(); };
</script>

<div id="layers" class="dockbody" bind:this={box}>
  {#if empty}
    <div class="empty">No lettering on this page yet. B bubble · O drawn bubble · T text · S sound effect · C caption.</div>
  {/if}
  {#each rows as r (r.key)}
    {#if r.l}
      {@const l = r.l}
      <div class="layer" class:on={r.on} class:dragover={over === r.key} draggable="true" role="option" aria-selected={r.on} tabindex="-1"
        onclick={() => pick(l)} ondblclick={() => rename(l)} oncontextmenu={e => menu(e, l)}
        ondragstart={e => e.dataTransfer!.setData("text/layer", l.id)}
        ondragover={e => { e.preventDefault(); over = r.key; }} ondragleave={() => { if (over === r.key) over = null; }} ondrop={e => drop(e, l)}>
        <button class="ib" class:offv={!r.visible} title="Show / hide" onclick={quiet(() => { l.visible = !l.visible; commit(); requestDraw(); })}>
          {@html svgIcon(r.visible ? "eye" : "eyeOff")}</button>
        <span class="slot" use:node={r.thumb}></span>
        <span class="nm" title={r.name}>{r.name}</span>
        <button class="ib" class:offv={!r.locked} title={r.locked ? "Unlock" : "Lock"} onclick={quiet(() => { l.locked = !l.locked; commit(); requestDraw(); })}>
          {@html svgIcon(r.locked ? "lock" : "unlock")}</button>
        <button class="ib del" title="Delete layer (Delete)" onclick={quiet(() => { S.sel = l.id; deleteSelected(); })}>{@html svgIcon("trash")}</button>
      </div>
    {:else if r.run}
      {@const run = r.run}
      <div class="layer run" class:on={r.on} class:dragover={over === r.key} role="button" tabindex="-1"
        title="The panel frames sit here in the stack. Click to work on them in the Panels tab; drop a layer here to put it just above them."
        onclick={() => setDockTab("panels", true)}
        ondragover={e => { e.preventDefault(); over = r.key; }} ondragleave={() => { if (over === r.key) over = null; }} ondrop={e => drop(e, run[0])}>
        <span>▭</span>{run.length} panel{run.length === 1 ? "" : "s"}<span class="go">›</span>
      </div>
    {/if}
  {/each}
</div>
<div class="panefoot">
  <button data-act="layerUp" title="Bring forward ( ] )">▲</button>
  <button data-act="layerDown" title="Send backward ( [ )">▼</button>
  <button data-act="duplicate" title="Duplicate (Ctrl+D)">⧉</button>
  <span class="spacer"></span>
  <button id="laydel" title="Delete the selected layer (Delete)" onclick={deleteSelected}>{@html svgIcon("trash")}</button>
</div>

<style>
  .slot { display: contents; }
</style>
