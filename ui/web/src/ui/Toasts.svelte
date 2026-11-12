<script lang="ts">
  import { ui } from "./store.svelte.ts";
</script>

<div id="toasts" aria-live="polite">
  {#each ui.toasts as t (t.id)}
    <div class="toast {t.kind}">{t.text}</div>
  {/each}
</div>
