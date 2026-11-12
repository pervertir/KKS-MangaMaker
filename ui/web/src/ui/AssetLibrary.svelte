<script lang="ts">
  /* Assets tab: the asset library shared by every project (assets/library/ on the editor machine).
     Click adds to the page, drag drops where it lands; backgrounds and face variants fill the panel under them. */
  import { ui } from "./store.svelte.ts";
  import { KIND_LABEL, lib, loadLibrary, matches, placeAsset, removeAsset, uploadAssets, type AssetKind, type LibAsset } from "../assets/library.ts";
  import { editAssetDialog, saveSelectionDialog } from "../assets/dialogs.ts";
  import { thumb } from "../editor/images.js";
  import { popMenu } from "../editor/menus.js";
  import { S, selL } from "../editor/state.ts";

  let q = $state(""), kind = $state(""), who = $state("");
  let picker = $state<HTMLInputElement>();
  if (!lib.loaded) loadLibrary();

  const all = (): LibAsset[] => (ui.rev, lib.assets);
  const loaded = () => (ui.rev, lib.loaded);
  const shown = $derived.by(() => all().filter(a => matches(a, q, kind, who)));
  const tags = $derived.by(() => {
    const n = new Map<string, number>();
    for (const a of shown) for (const t of a.tags) n.set(t, (n.get(t) || 0) + 1);
    return [...n].filter(([t]) => !q.toLowerCase().split(/\s+/).includes(t)).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t]) => t);
  });
  const kinds = $derived.by(() => { ui.rev; return lib.kinds.filter(k => lib.assets.some(a => a.kind === k)); });
  const canSave = () => (ui.rev, !!S.doc && !!selL());

  const src = (a: LibAsset) => a.thumb ? thumb(a.thumb, 260) : "";
  const drag = (a: LibAsset) => (e: DragEvent) => e.dataTransfer!.setData("application/x-manga", JSON.stringify({ kind: "libasset", id: a.id }));
  const addTag = (t: string) => { q = (q.trim() + " " + t).trim(); };
  function menu(e: MouseEvent, a: LibAsset) {
    e.preventDefault();
    popMenu(e.clientX, e.clientY, [["Add to page", () => placeAsset(a)], ["Edit name, tags, character…", () => editAssetDialog(a)], null,
      ["Remove from library", () => { if (confirm(`Remove "${a.name}" from the library? Pages that use it keep their copy.`)) removeAsset(a); }]]);
  }
  async function upload() { await uploadAssets(picker!.files!, (kind || "prop") as AssetKind); picker!.value = ""; }
</script>

<div class="assettools">
  <input type="search" placeholder="Search name, tag, character…" bind:value={q} />
  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple hidden bind:this={picker} onchange={upload} />
  <button title="Add pictures to the library (as the kind picked below)" onclick={() => picker!.click()}>Upload…</button>
  <button title="Save the selected layer, or a panel with everything on it" disabled={!canSave()} onclick={saveSelectionDialog}>Save selection</button>
</div>
<div class="chips">
  <button class:on={kind === ""} onclick={() => kind = ""}>All</button>
  {#each kinds as k (k)}<button class:on={kind === k} onclick={() => kind = k}>{KIND_LABEL[k]}</button>{/each}
  {#if (ui.rev, lib.characters.length)}
    <select class="who" bind:value={who} title="Only this character's assets">
      <option value="">Any character</option>
      {#each lib.characters as c (c)}<option value={c}>{c}</option>{/each}
    </select>
  {/if}
</div>
{#if tags.length}
  <div class="tagrow">{#each tags as t (t)}<button onclick={() => addTag(t)}>#{t}</button>{/each}</div>
{/if}
<div id="library" class="dockbody">
  {#if !loaded()}
    <div class="hint">Loading the library…</div>
  {:else if !shown.length}
    <div class="hint">{all().length ? "Nothing matches." : "The library is empty. Upload pictures, or select something on the page and Save selection."}</div>
  {:else}
    <div class="tiles wide">
      {#each shown as a (a.id)}
        <div class="tile light" title={`${a.name}${a.character ? " · " + a.character : ""}${a.tags.length ? "\n#" + a.tags.join(" #") : ""}\nClick to add, or drag onto the page`}
          draggable="true" role="button" tabindex="-1" onclick={() => placeAsset(a)} ondragstart={drag(a)} oncontextmenu={e => menu(e, a)}>
          {#if src(a)}<img src={src(a)} alt="" loading="lazy" />{:else}<span class="none">{a.kind}</span>{/if}
          {#if a.character}<span class="who-badge">{a.character}</span>{/if}
          <div class="cap">{a.name}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .assettools { flex: none; display: flex; flex-wrap: wrap; gap: var(--s2); padding: var(--s2) var(--s2) 0; }
  .assettools input[type=search] { flex: 1 0 100%; min-width: 0; }
  .assettools button { flex: 1; min-height: var(--h-sm); }
  .chips .who { margin-left: auto; min-height: var(--h-sm); font-size: var(--f-sm); max-width: 140px; }
  .tagrow { flex: none; display: flex; flex-wrap: wrap; gap: 2px var(--s1); padding: var(--s1) var(--s2) 0; }
  .tagrow button { min-height: 0; padding: 1px 4px; border: none; background: none; color: var(--muted); font-size: var(--f-xs); }
  .tagrow button:hover { color: var(--text); }
  .who-badge { position: absolute; top: 3px; left: 3px; font-size: var(--f-xs); background: #000a; color: #fff; padding: 1px 5px; border-radius: 99px; }
  .none { color: #666; font-size: var(--f-sm); }
</style>
