<script lang="ts">
  /* Library tab: shots and their renders, bubble templates, layouts and artwork. Everything here is
     either clicked (acts on the selection or the page) or dragged onto the page; the drop itself is
     handled by the stage (src/editor/library.js). */
  import { ui } from "./store.svelte.ts";
  import { node } from "./mount.ts";
  import { addImageLayer, setPanelImage } from "../editor/creation.js";
  import { commit } from "../editor/history.js";
  import { thumb } from "../editor/images.js";
  import { renderShot } from "../editor/jobs.js";
  import { applyLayout, presetTiles, shapedTiles } from "../editor/layouts.js";
  import { LIBTABS, imgSize, renderLibrary, uploadFile } from "../editor/library.js";
  import { status } from "../editor/misc.js";
  import { renderOptions } from "../editor/options.js";
  import { loadShots, shotDialog } from "../editor/shots.js";
  import { S, selL } from "../editor/state.ts";
  import { setTool } from "../editor/tools.js";
  import { requestDraw } from "../editor/view.js";

  type Obj = Record<string, any>;
  const tab = (): string => (ui.rev, S.libTab);
  const shots = (): Obj[] => (ui.rev, S.shots || []);
  const cat = (): Obj => (ui.rev, S.cat || { bubbles: [], layouts: [], assets: {} });
  const assets = (): Obj[] => cat().assets?.[tab()] || [];
  const images = (s: Obj): [string, string][] => [...s.renders.map((r: string): [string, string] => [r, "render"]), ...s.finals.map((r: string): [string, string] => [r, "final"])];
  // the built-in layout tiles are drawn by the editor; redrawn when the reading direction flips
  const presets = $derived.by(() => { ui.rev; return S.doc && S.libTab === "layouts" ? { dir: S.doc.reading, el: presetTiles((r: unknown, n: string) => applyLayout(r, n)), shaped: shapedTiles((r: unknown, n: string) => applyLayout(r, n)) } : null; });

  let picker = $state<HTMLInputElement>();
  const drag = (data: Obj) => (e: DragEvent) => e.dataTransfer!.setData("application/x-manga", JSON.stringify(data));
  const go = (k: string) => { S.libTab = k; renderLibrary(); };

  function useRender(ref: string, shot: string) {
    const l = selL();
    if (l?.type === "panel") setPanelImage(l, ref, shot); else status("Select a panel, or drag the render onto one");
  }
  function pickBubble(b: Obj) {
    S.bubble = b.key;
    const l = selL();
    if (l?.type === "bubble") { l.bubble = b.key; l.h = l.w * b.h / b.w; commit("Bubble changed"); requestDraw(); }
    else setTool("bubble");
    renderLibrary(); renderOptions();
  }
  async function addAsset(a: Obj) { const dim = await imgSize(a.ref); addImageLayer(a.ref, dim.w, dim.h, null, a.multiply); }
  async function upload() { for (const f of picker!.files!) await uploadFile(f); picker!.value = ""; }
</script>

<div class="chips" id="libtabs">
  {#each LIBTABS as [k, t] (k)}<button class:on={tab() === k} onclick={() => go(k)}>{t}</button>{/each}
</div>
<div id="libtools">
  {#if tab() === "shots"}
    <button onclick={() => shotDialog(null, true)}>＋ New shot</button>
    <button onclick={() => shotDialog(null)}>Edit shots…</button>
    <button title="Rescan shots/" onclick={loadShots}>⟳</button>
  {:else if tab() === "uploads"}
    <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden bind:this={picker} onchange={upload} />
    <button onclick={() => picker!.click()}>Upload images…</button>
  {/if}
</div>
<div id="library" class="dockbody">
  {#if tab() === "shots"}
    {#each shots() as s (s.name)}
      {@const all = images(s)}
      <div class="shotcard">
        <div class="top"><b title={s.name}>{s.name}</b>
          <span><span class="badge">{s.renders.length} render{s.renders.length === 1 ? "" : "s"}</span>
            <button onclick={() => shotDialog(s.name)}>Edit</button>
            <button class="primary" disabled={!s.pose} title="Render on the RunPod pod" onclick={() => renderShot(s.name)}>Render</button></span></div>
        <div class="imgs">
          {#each all as [ref, kind] (ref)}
            <img src={thumb(ref, 200)} alt="" loading="lazy" draggable="true" title={`${kind}: ${ref.split("/").pop()} — drag onto a panel`}
              onclick={() => useRender(ref, s.name)} ondragstart={drag({ kind: "render", ref, shot: s.name })} />
          {:else}
            {#if s.pose}<img src={thumb(s.pose, 200)} alt="" title="pose (not rendered yet)" style="opacity:.7" />{/if}
            <div class="none">{s.pose ? "Not rendered yet." : "No pose yet: Grab from Studio."}</div>
          {/each}
        </div>
      </div>
    {:else}
      <div class="hint">No shots yet. Create one, pose it in CharaStudio, then Grab and Render.</div>
    {/each}
  {:else if tab() === "bubbles"}
    {#if cat().bubbles.length}
      <div class="hint">Click to pick for the bubble tool (or to swap the selected bubble). Drag onto the page to place.</div>
      <div class="tiles">
        {#each cat().bubbles as b (b.key)}
          <div class="tile light" class:on={b.key === (ui.rev, S.bubble)} title={"#" + b.key} draggable="true" role="button" tabindex="-1"
            onclick={() => pickBubble(b)} ondragstart={drag({ kind: "bubble", key: b.key })}>
            <img src={thumb(b.ref, 160)} alt="" loading="lazy" /><div class="cap">#{b.key}</div></div>
        {/each}
      </div>
    {:else}
      <div class="hint">No bubble templates installed (templates_dir in config). The drawn bubble tool (O) needs none.</div>
    {/if}
  {:else if tab() === "layouts"}
    <div class="hint">Click to apply to this page (renders already placed carry over in reading order).</div>
    <div class="section">Built-in</div>
    {#if presets}{#key presets.dir}<div class="slot" use:node={presets.el}></div>
      <div class="section">Shaped frames</div><div class="slot" use:node={presets.shaped}></div>{/key}{/if}
    {#if cat().layouts.length}
      <div class="section">Template pack</div>
      <div class="tiles">
        {#each cat().layouts as L (L.n)}
          <div class="tile page" title={`Template ${L.n}: ${L.rects.length} panels`} role="button" tabindex="-1" onclick={() => applyLayout(L.rects, "#" + L.n)}>
            <img src={thumb(L.ref, 160)} alt="" loading="lazy" /><div class="cap">#{L.n} · {L.rects.length}</div></div>
        {/each}
      </div>
    {/if}
  {:else}
    {#if tab() === "uploads" && !assets().length}
      <div class="hint">Upload screentones, backgrounds or logos, or drop image files straight onto the page.</div>
    {/if}
    <div class="tiles wide">
      {#each assets() as a (a.ref)}
        <div class="tile light" title={a.name + " — click to add, or drag"} draggable="true" role="button" tabindex="-1"
          onclick={() => addAsset(a)} ondragstart={drag({ kind: "asset", ref: a.ref, multiply: a.multiply })}>
          <img src={thumb(a.ref, 260)} alt="" loading="lazy" /><div class="cap">{a.name}</div></div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .slot { display: contents; }
</style>
