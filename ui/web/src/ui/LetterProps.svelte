<script lang="ts">
  /* Lettering settings: balloon outline and tails, vertical text and furigana, SFX baseline and effects. */
  import { ui } from "./store.svelte.ts";
  import { commit } from "../editor/history.js";
  import { requestDraw } from "../editor/view.js";
  import { toast } from "../editor/misc.js";
  import { CURVES, PRESETS, applyPreset, edit, makeEditable, newTail, setCurve } from "../lettering/index.ts";
  import { anchors, fromAnchors } from "../lettering/handles.ts";
  import { toggleSmooth } from "../lettering/geom.ts";
  import { WARPS } from "../lettering/sfx.ts";

  import type { Layer } from "../types.ts";
  type Obj = Record<string, any>;
  type Opt = [string | number, string];
  let { l, kind }: { l: Layer; kind: "balloon" | "text" | "convert" } = $props();

  const R = <T,>(o: T): T => (ui.rev, o);
  const live = () => { requestDraw(); ui.rev++; };
  const done = (msg?: string) => { commit(msg); requestDraw(); ui.rev++; };
  const put = (o: Obj, k: string, v: unknown, msg?: string) => { o[k] = v; done(msg); };
  const val = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const on = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
  const pct = (v: number) => Math.round(v * 100) + "%";
  type Field = HTMLInputElement | HTMLSelectElement;
  function field(el: Field, get: () => unknown) {
    $effect(() => { ui.rev; const v = String(get() ?? ""); if (el.value !== v && document.activeElement !== el) el.value = v; });
  }
  function tick(el: HTMLInputElement, get: () => unknown) { $effect(() => { ui.rev; el.checked = !!get(); }); }

  const editing = () => (ui.rev, edit.shape === l.id);
  const node = () => (ui.rev, edit.node);
  const glyph = () => (ui.rev, edit.glyph);
  const g = (i: number): Obj => { l.glyphs ||= []; while (l.glyphs.length <= i) l.glyphs.push({}); return l.glyphs[i]; };

  function toggleEdit() { edit.shape = edit.shape === l.id ? null : l.id; edit.node = -1; live(); }
  function smoothPoint() { const as = anchors(l.path); if (edit.node < 0 || edit.node >= as.length) return;
    const n = as.map(a => ({ x: a.p[0], y: a.p[1], ...(a.i ? { i: [a.i[0] - a.p[0], a.i[1] - a.p[1]] } : {}), ...(a.o ? { o: [a.o[0] - a.p[0], a.o[1] - a.p[1]] } : {}) })) as any;
    const t = toggleSmooth(n, edit.node);
    l.path = fromAnchors(t.map((q: Obj) => ({ p: [q.x, q.y], ...(q.i ? { i: [q.x + q.i[0], q.y + q.i[1]] } : {}), ...(q.o ? { o: [q.x + q.o[0], q.y + q.o[1]] } : {}) })));
    done("Point changed"); }
  function deletePoint() { const as = anchors(l.path); if (edit.node < 0 || as.length <= 3) return; as.splice(edit.node, 1); l.path = fromAnchors(as); edit.node = -1; done("Point removed"); }
  async function convert() { if (await makeEditable(l)) done("Bubble made editable"); else toast("Could not trace this bubble's outline", "bad"); }
</script>

{#snippet slider(label: string, o: Obj, key: string, min: number, max: number, step: number, fmt: (v: number) => string | number = v => v, def = 0)}
  <div class="row"><label>{label}</label>
    <input type="range" {min} {max} {step} use:field={() => R(o)[key] ?? def} oninput={e => { o[key] = +val(e); live(); }} onchange={() => done()} />
    <span class="val">{fmt(R(o)[key] ?? def)}</span></div>
{/snippet}
{#snippet check(label: string, o: Obj, key: string, title = "")}
  <label class="inl" {title}><input type="checkbox" use:tick={() => !!R(o)[key]} onchange={e => put(o, key, on(e))} />{label}</label>
{/snippet}
{#snippet select(label: string, opts: Opt[], value: unknown, pick: (v: string) => void)}
  <div class="row"><label>{label}</label>
    <select use:field={() => String(value ?? "")} onchange={e => pick(val(e))}>
      {#each opts as [v, t] (v)}<option value={String(v)}>{t}</option>{/each}
    </select></div>
{/snippet}
{#snippet textOpts(o: Obj)}
  <div class="section">Japanese text</div>
  <div class="btnrow">{@render check("Vertical (tategaki)", o, "vertical", "Columns right to left; numbers and !? stand upright inside a column")}</div>
  {@render slider("Furigana", o, "rubySize", 0.3, 0.7, 0.01, pct, 0.5)}
  {@render slider("Spacing", o, "tracking", -0.2, 0.6, 0.01, v => v.toFixed(2) + " em", 0)}
  {@render slider("Line gap", o, "lineGap", -0.3, 1, 0.01, v => v.toFixed(2) + " em", 0)}
  <p class="hint">Furigana: <code>{"{漢字|かんじ}"}</code>, <code>|漢字《かんじ》</code> or <code>漢字《かんじ》</code>; per character <code>{"{漢|かん}{字|じ}"}</code>.</p>
{/snippet}

{#if kind === "convert"}
  <div class="btnrow"><button title="Turn the outline into points you can drag" onclick={convert}>Make outline editable</button></div>
{:else if kind === "balloon"}
  <div class="section">Outline</div>
  {@render select("Shape", [...PRESETS, ...(R(l).preset === "traced" ? [["traced", "Traced template"]] : [])] as Opt[], R(l).preset, v => { applyPreset(l, v); done("Shape changed"); })}
  <div class="btnrow">
    <button class:primary={editing()} onclick={toggleEdit}>{editing() ? "Done editing" : "Edit outline"}</button>
    {#if ["cloud", "burst", "flash"].includes(R(l).preset)}<button onclick={() => { l.seed = Math.floor(Math.random() * 1e6); applyPreset(l, l.preset); done("Reshuffled"); }}>Reshuffle</button>{/if}
  </div>
  {#if editing()}
    <p class="hint">Drag points and their handles. Double-click the outline to add a point; Alt-click a point to remove it.</p>
    {#if node() >= 0}<div class="btnrow"><button onclick={smoothPoint}>Smooth / corner</button><button onclick={deletePoint}>Delete point</button></div>{/if}
  {/if}
  {#if ["burst", "flash"].includes(R(l).preset)}{@render slider("Spikes", l, "spikes", 6, 48, 1, v => v, 16)}{/if}
  <div class="row"><label>Fill / line</label>
    <input type="color" use:field={() => R(l).fill} oninput={e => { l.fill = val(e); live(); }} onchange={() => done()} />
    <input type="color" use:field={() => R(l).stroke} oninput={e => { l.stroke = val(e); live(); }} onchange={() => done()} />
    <input type="number" min="0" style="width:56px" title="line width" use:field={() => R(l).strokeW} onchange={e => put(l, "strokeW", +val(e))} /></div>
  <div class="btnrow">{@render check("Dashed", l, "dash")}{@render check("Join overlapping", l, "merge", "Balloons that overlap share one outline")}</div>
  <div class="section">Tails</div>
  {#each R(l).tails || [] as t, i (i)}
    <div class="row"><label>Tail {i + 1}</label>
      <select use:field={() => R(t).kind} onchange={e => put(t, "kind", val(e))}>
        <option value="curved">Curved</option><option value="straight">Straight</option><option value="dots">Thought dots</option></select>
      <button class="ghost" title="Remove this tail" onclick={() => { l.tails.splice(i, 1); done("Tail removed"); }}>✕</button></div>
    {#if t.kind !== "dots"}
      {@render slider("Width", t, "width", 0.05, 0.6, 0.01, v => v.toFixed(2), 0.22)}
      {#if t.kind === "curved"}{@render slider("Bend", t, "bend", -0.6, 0.6, 0.01, v => v.toFixed(2), 0.18)}{/if}
    {/if}
  {/each}
  <div class="btnrow"><button onclick={() => { (l.tails ||= []).push(newTail(l, l.preset === "cloud" ? "dots" : "curved")); done("Tail added"); }}>Add tail</button></div>
  <p class="hint">Drag a pink dot to aim its tail.</p>
  {@render textOpts(l)}
{:else}
  {@render textOpts(l)}
  {#if R(l).sfx}
    <div class="section">Sound effect</div>
    {@render select("Baseline", [["", "None (box)"], ...CURVES.map(([k, t]): Opt => [k, t])], R(l).curve ? "custom" : "", v => { setCurve(l, v || null); done(v ? "SFX on a path" : "SFX path removed"); })}
    {#if R(l).curve}<p class="hint">Drag the blue points to bend the baseline, orange diamonds to nudge a letter.</p>{/if}
    {@render select("Warp", WARPS as Opt[], R(l).warp || "none", v => put(l, "warp", v))}
    {#if (R(l).warp || "none") !== "none"}{@render slider("Amount", l, "warpAmt", -1, 1, 0.01, v => v.toFixed(2), 0.5)}{/if}
    {@render slider("Rough", l, "rough", 0, 1, 0.01, pct, 0)}
    {#if R(l).rough}<div class="btnrow"><button onclick={() => put(l, "seed", Math.floor(Math.random() * 1e6), "Reshuffled")}>Reshuffle</button></div>{/if}
    <div class="row"><label>Paper line</label>
      <input type="color" use:field={() => R(l).paper || "#ffffff"} oninput={e => { l.paper = val(e); live(); }} onchange={() => done()} />
      <input type="range" min="0" max="40" step="1" use:field={() => R(l).paperW || 0} oninput={e => { l.paperW = +val(e); live(); }} onchange={() => done()} />
      <span class="val">{R(l).paperW || 0}</span></div>
    {@render slider("Trail", l, "trail", 0, 8, 1, v => v, 0)}
    {#if R(l).trail}
      {@render slider("Trail length", l, "trailLen", 0.2, 4, 0.05, v => v.toFixed(2) + " em", 1.2)}
      {@render slider("Trail angle", l, "trailDir", -180, 180, 1, v => v + "°", 180)}
    {/if}
    {#if R(l).curve && glyph() >= 0}
      <div class="section">Letter {glyph() + 1}</div>
      {@render slider("Scale", g(glyph()), "s", 0.3, 2.5, 0.01, v => v.toFixed(2) + "×", 1)}
      {@render slider("Turn", g(glyph()), "r", -90, 90, 1, v => v + "°", 0)}
      <div class="btnrow"><button onclick={() => { l.glyphs[glyph()] = {}; done("Letter reset"); }}>Reset letter</button>
        <button onclick={() => { l.glyphs = []; edit.glyph = -1; done("Letters reset"); }}>Reset all</button></div>
    {/if}
  {/if}
{/if}

<style>
  .inl { display: flex; gap: 5px; align-items: center; color: var(--muted); }
  code { font-size: 11px; }
</style>
