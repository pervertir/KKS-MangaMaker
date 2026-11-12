<script>
  /* The lower dock: Layers | Panels | Library. Layers and Panels are components; the Library pane still
     hosts the editor's own renderer (src/editor/library.js) until it is ported too. */
  import { ui } from "./store.svelte.js";
  import LayersPane from "./LayersPane.svelte";
  import PanelsPane from "./PanelsPane.svelte";
  import { setDockTab } from "../editor/dock-tabs.js";
  import { S, layers } from "../editor/state.js";

  const counts = $derived.by(() => {
    ui.rev;
    if (!S.doc) return { layers: 0, panels: 0 };
    const ls = layers(), panels = ls.filter(l => l.type === "panel").length;
    return { layers: ls.length - panels, panels };
  });
  const TABS = [
    ["layers", "Layers", "Lettering, tones and images on this page, front to back"],
    ["panels", "Panels", "This page's panels in reading order, with their shots and renders"],
    ["library", "Library", "Shots, bubbles, layouts and artwork to put on the page"],
  ];
</script>

<div class="dockhead tabs" id="docktabs" role="tablist">
  {#each TABS as [id, label, tip] (id)}
    <button role="tab" data-tab={id} title={tip} class:on={ui.dockTab === id} aria-selected={ui.dockTab === id} onclick={() => setDockTab(id, true)}>
      {label}{#if id !== "library"}&nbsp;<span class="cnt">{counts[id] || ""}</span>{/if}
    </button>
  {/each}
</div>
<div class="tabpane" id="pane-layers" role="tabpanel" hidden={ui.dockTab !== "layers"}><LayersPane /></div>
<div class="tabpane" id="pane-panels" role="tabpanel" hidden={ui.dockTab !== "panels"}><PanelsPane /></div>
<div class="tabpane" id="pane-library" role="tabpanel" hidden={ui.dockTab !== "library"}>
  <div class="chips" id="libtabs"></div>
  <div id="libtools"></div>
  <div id="library" class="dockbody"></div>
</div>
