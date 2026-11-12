<script>
  /* Panels tab: the page's frames in reading order (panelOrder, the rule the pipeline uses), each with its
     shot, how far along it is and the one action that moves it on. The order comes from where the frames
     sit, so rows are not draggable: to change it, move the frames or apply a layout. */
  import { tick } from "svelte";
  import { ui } from "./store.svelte.js";
  import { node } from "./mount.js";
  import { enterAdjust } from "../editor/adjust.js";
  import { showLib } from "../editor/dock-tabs.js";
  import { layerThumb, svgIcon } from "../editor/layers.js";
  import { layoutDialog } from "../editor/layouts.js";
  import { popMenu } from "../editor/menus.js";
  import { refreshPanels, status } from "../editor/misc.js";
  import { panelMenu, panelState, toggleOrder } from "../editor/panels-tab.js";
  import { S, layers, selL } from "../editor/state.js";
  import { setTool } from "../editor/tools.js";
  import { panelOrder, requestDraw } from "../editor/view.js";

  const view = $derived.by(() => {
    ui.rev;
    if (!S.doc) return { rows: [], order: false };
    const ls = layers(), order = panelOrder(ls), hidden = ls.filter(l => l.type === "panel" && !l.visible);
    const sel = selL(), kidOf = sel && sel.type !== "panel" ? sel.clip : null;      // a tone or lines clipped to this frame
    const row = (l, n) => {
      const st = panelState(l), [label, fn, tip, main] = st.act;
      return { key: l.id, l, n, on: l.id === S.sel, kid: kidOf === l.id, off: !l.visible, thumb: layerThumb(l, 44),
        name: l.name || l.shot || "no shot", named: !!(l.name || l.shot), shotTip: l.shot ? `Shot ${l.shot}` : "No shot yet: Pose… makes one",
        st, stText: st.text + (l.locked ? " · locked" : ""), label, fn, tip, main };
    };
    return { rows: [...order.map((l, i) => row(l, i + 1)), ...hidden.map(l => row(l, 0))], order: !!S.showOrder };
  });

  let box = $state(), lastSel = null;
  $effect(() => {
    ui.rev;
    if (S.sel === lastSel) return;
    lastSel = S.sel;
    tick().then(() => box?.querySelector(".on")?.scrollIntoView({ block: "nearest" }));
  });

  const pick = l => { S.sel = l.id; refreshPanels(); requestDraw(); };
  const menu = (l, x, y) => { if (S.sel !== l.id) pick(l); popMenu(x, y, panelMenu(l)); };
  function open(l) { if (l.image) enterAdjust(l); else { showLib("shots"); status("Drag a render from Shots onto the panel"); } }
  const quiet = fn => e => { e.stopPropagation(); fn(e); };
</script>

<div id="paneltools">
  <button title="Replace this page's panels with a layout (renders carry over in reading order)" onclick={layoutDialog}>Layout…</button>
  <button id="ordbtn" class="toggle" class:on={view.order} aria-pressed={view.order} title="Show the reading-order numbers on the page (M)" onclick={toggleOrder}>Order</button>
  <span class="spacer"></span>
  <button title="Draw a panel frame on the page (P)" onclick={() => setTool("panel")}>＋ Panel</button>
</div>
<div id="panels" class="dockbody" bind:this={box}>
  {#each view.rows as r (r.key)}
    <div class="prow" class:on={r.on} class:kid={r.kid} class:off={r.off} role="option" aria-selected={r.on} tabindex="-1"
      onclick={() => pick(r.l)} ondblclick={() => open(r.l)} oncontextmenu={e => { e.preventDefault(); menu(r.l, e.clientX, e.clientY); }}>
      {#if r.n}
        <span class="pnum" title={`Panel ${r.n} in reading order`}>{r.n}</span>
      {:else}
        <span class="pnum none" title="Hidden: not part of the reading order">{@html svgIcon("eyeOff")}</span>
      {/if}
      <span class="slot" use:node={r.thumb}></span>
      <div class="ptxt">
        <span class="nm" class:none={!r.named} title={r.shotTip}>{r.name}</span>
        <span class="st" title={r.st.tip || r.st.text}><span class="g {r.st.cls}">{r.st.g}</span>{r.stText}</span>
      </div>
      <button class="pact" class:primary={r.main && r.on} title={r.tip} ondblclick={e => e.stopPropagation()}
        onclick={quiet(() => { if (S.sel !== r.l.id) pick(r.l); r.fn(); })}>{r.label}</button>
      <button class="ib" title="More: pose, render, split, hide, lock, delete" ondblclick={e => e.stopPropagation()}
        onclick={quiet(e => { const b = e.currentTarget.getBoundingClientRect(); menu(r.l, b.left, b.bottom + 2); })}>⋯</button>
    </div>
  {:else}
    <div class="empty">No panels on this page.
      <div class="btnrow"><button onclick={layoutDialog}>Choose layout…</button><button onclick={() => setTool("panel")}>Draw a panel (P)</button></div>
    </div>
  {/each}
</div>

<style>
  .slot { display: contents; }
</style>
