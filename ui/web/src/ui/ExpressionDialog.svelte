<script lang="ts">
  /* New expression: one character's face in a render is inpainted on the pod with that character's LoRA
     and the expression tags; the result is saved to the asset library under the character. */
  import { newExpression } from "../assets/library.ts";
  import { thumb } from "../editor/images.js";
  import { closeModal } from "../editor/modal.js";
  import { S } from "../editor/state.ts";

  let { shot, ref }: { shot: string; ref: string } = $props();
  const PRESETS = ["smile", "laughing", "angry", "crying, tears", "surprised, open mouth", "embarrassed, blush", "sad", "smug", "closed eyes", "pout", "scared", "determined"];
  const yaml = String(S.shots.find(s => s.name === shot)?.yaml || "");
  const block = yaml.split(/^characters:.*$/m)[1]?.split(/^\S/m)[0] || "";
  const names = [...block.matchAll(/^\s*-\s*name:\s*"?([^"\n#]*)"?/gm)].map((m, i) => m[1].trim() || `Character ${i + 1}`);
  let who = $state(1), tags = $state("");
  const pick = (p: string) => { tags = tags.trim() ? `${tags.trim()}, ${p}` : p; };
  function go(e: Event) { e.preventDefault(); if (!tags.trim()) return; newExpression(shot, ref, who, tags.trim()); closeModal(); }
</script>

<form class="mbody form" onsubmit={go}>
  <div class="prev"><img src={thumb(ref, 320)} alt="" /></div>
  {#if names.length > 1}
    <div class="row"><label for="ex-who">Character</label>
      <select id="ex-who" bind:value={who}>{#each names as n, i (i)}<option value={i + 1}>{n} ({i === 0 ? "leftmost" : `${i + 1}. from the left`})</option>{/each}</select></div>
  {:else}
    <div class="row"><label for="ex-who">Character</label><span id="ex-who">{names[0] || "the character in the shot"}</span></div>
  {/if}
  <div class="row"><label for="ex-tags">Expression</label><input id="ex-tags" bind:value={tags} placeholder="smile, closed eyes" /></div>
  <div class="chips">{#each PRESETS as p (p)}<button type="button" onclick={() => pick(p)}>{p}</button>{/each}</div>
  <div class="hint">Runs on the RunPod pod: the face is found and repainted with the character's LoRA, the rest of the picture stays. The result appears under Assets › Expressions.</div>
</form>
<div class="mfoot"><button type="button" onclick={closeModal}>Cancel</button><button class="primary" disabled={!tags.trim()} onclick={go}>Make expression</button></div>

<style>
  .prev { display: flex; justify-content: center; background: #e9e9ec; border-radius: var(--r1); padding: var(--s2); margin-bottom: var(--s3); }
  .prev img { max-width: 100%; max-height: 220px; object-fit: contain; }
  .chips { padding: 0 0 var(--s2); }
</style>
