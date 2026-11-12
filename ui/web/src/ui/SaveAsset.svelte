<script lang="ts">
  /* The form behind "Save to asset library" and "Edit" on a library asset. */
  import { KIND_LABEL, lib, saveAsset, updateAsset, type AssetKind, type LibAsset, type SaveRequest } from "../assets/library.ts";
  import { thumb } from "../editor/images.js";
  import { closeModal } from "../editor/modal.js";
  import { untrack } from "svelte";

  let { draft = null, asset = null }: { draft?: SaveRequest | null; asset?: LibAsset | null } = $props();
  const start = untrack(() => asset ? { ...asset, tags: asset.tags.join(", ") } : draft!);
  let name = $state(start.name), kind = $state<AssetKind>(start.kind), tags = $state(start.tags), who = $state(start.character || "");
  let busy = $state(false);
  const preview = $derived(asset ? (asset.thumb ? thumb(asset.thumb, 320) : "") : draft!.thumb || (draft!.ref ? thumb(draft!.ref, 320) : ""));

  async function go(e: Event) {
    e.preventDefault(); busy = true;
    if (asset) await updateAsset(asset, { name, kind, tags: tags.split(",").map(t => t.trim()).filter(Boolean), character: who });
    else if (!await saveAsset({ ...draft!, name, kind, tags, character: who })) { busy = false; return; }
    closeModal();
  }
</script>

<form class="mbody form" onsubmit={go}>
  {#if preview}<div class="prev"><img src={preview} alt="" /></div>{/if}
  <div class="row"><label for="as-name">Name</label><input id="as-name" bind:value={name} maxlength="80" /></div>
  <div class="row"><label for="as-kind">Kind</label>
    <select id="as-kind" bind:value={kind}>{#each lib.kinds as k (k)}<option value={k}>{KIND_LABEL[k]}</option>{/each}</select></div>
  <div class="row"><label for="as-tags">Tags</label><input id="as-tags" bind:value={tags} placeholder="school, night, rain" /></div>
  <div class="row"><label for="as-who">Character</label><input id="as-who" bind:value={who} list="as-chars" placeholder="none" />
    <datalist id="as-chars">{#each lib.characters as c (c)}<option value={c}></option>{/each}</datalist></div>
  <div class="hint">Images are copied into the library, so the asset stays even if the shot or upload it came from is deleted.</div>
</form>
<div class="mfoot"><button type="button" onclick={closeModal}>Cancel</button><button class="primary" disabled={busy || !name.trim()} onclick={go}>{asset ? "Save" : "Save to library"}</button></div>

<style>
  .prev { display: flex; justify-content: center; background: #e9e9ec; border-radius: var(--r1); padding: var(--s2); margin-bottom: var(--s3); }
  .prev img { max-width: 100%; max-height: 200px; object-fit: contain; }
</style>
