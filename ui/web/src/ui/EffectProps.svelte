<script lang="ts">
  /* Properties of a screentone or speed-lines layer. Same conventions as Props.svelte: every read goes
     through R(), which depends on ui.rev, so the controls follow drags and undo. */
  import { ui } from "./store.svelte.ts";
  import { commit } from "../editor/history.js";
  import { requestDraw, panelOrder } from "../editor/view.js";
  import { layers } from "../editor/state.ts";
  import { showLib } from "../editor/dock-tabs.js";
  import { toast } from "../editor/misc.js";
  import { SHAPES, saveUserTone, specOf, type Gradient, type Stop } from "../editor/effects/tones.ts";
  import { MODES } from "../editor/effects/speed.ts";
  import { clearRegion, fitToSelection, pageSelection, regionFromSelection } from "../editor/effects/apply.ts";
  import { makeInnerEditable } from "../editor/effects/handles.ts";

  type Obj = Record<string, any>;
  type Opt = [string | number, string];
  let { l }: { l: Obj } = $props();

  const R = <T,>(o: T): T => (ui.rev, o);
  type Field = HTMLInputElement | HTMLSelectElement;
  function field(el: Field, get: () => unknown) {
    $effect(() => {
      ui.rev;
      const v = String(get() ?? "");
      const typing = document.activeElement === el && ["text", "number"].includes((el as HTMLInputElement).type);
      if (el.value !== v && !typing) el.value = v;
    });
  }
  const live = () => { requestDraw(); ui.rev++; };
  const done = (msg?: string) => { commit(msg); requestDraw(); ui.rev++; };
  const put = (o: Obj, k: string, v: unknown, msg?: string) => { o[k] = v; done(msg); };
  const val = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const pct = (v: number) => Math.round(v) + "%";
  const hasSel = () => (ui.rev, !!pageSelection());
  const clipOpts = (): Opt[] => [["", "— none —"], ...panelOrder(layers()).map((q: Obj, i: number): Opt => [q.id, `Panel ${i + 1}${q.shot ? " · " + q.shot : ""}`])];
  const reseed = () => put(l, "seed", Math.floor(Math.random() * 1e6), "Reshuffled");

  /* gradient */
  function setGrad(kind: string) {
    if (kind === "none") return put(l, "grad", null, "Gradient off");
    const g: Gradient = l.grad ? { ...l.grad, kind } : kind === "radial"
      ? { kind: "radial", a: [0.5, 0.5], b: [1, 1], stops: [[0, l.pct], [1, 0]] }
      : { kind: "linear", a: [0.5, 0.04], b: [0.5, 0.96], stops: [[0, l.pct], [1, 0]] };
    put(l, "grad", g, "Gradient");
  }
  const stops = (): Stop[] => (ui.rev, l.grad?.stops || []);
  function setStop(i: number, j: 0 | 1, v: number, final = false) {
    const s = l.grad.stops.map((q: Stop) => [...q]); s[i][j] = v; l.grad = { ...l.grad, stops: s };
    final ? done() : live();
  }
  function addStop() {
    const s: Stop[] = [...l.grad.stops].sort((p: Stop, q: Stop) => p[0] - q[0]);
    let at = 0.5, best = 0;
    for (let i = 1; i < s.length; i++) if (s[i][0] - s[i - 1][0] > best) { best = s[i][0] - s[i - 1][0]; at = (s[i][0] + s[i - 1][0]) / 2; }
    const v = s.length ? s.reduce((a, q) => a + q[1], 0) / s.length : l.pct;
    l.grad = { ...l.grad, stops: [...s, [+at.toFixed(3), Math.round(v)]] }; done("Stop added");
  }
  function dropStop(i: number) { if (l.grad.stops.length <= 2) return; l.grad = { ...l.grad, stops: l.grad.stops.filter((_: Stop, k: number) => k !== i) }; done("Stop removed"); }
  function flip() { l.grad = { ...l.grad, a: l.grad.b, b: l.grad.a }; done("Gradient reversed"); }

  function saveTone() {
    const name = prompt("Name for this tone in the library", `${SHAPES.find(s => s[0] === l.shape)?.[1] || "Tone"} ${l.lpi} L ${l.pct}%`);
    if (!name) return;
    saveUserTone(name, specOf(l)); toast(`Saved "${name}" to Library › Tones`, "ok"); ui.rev++;
  }
</script>

{#snippet slider(label: string, key: string, min: number, max: number, step: number, fmt: (v: number) => string | number = v => v, title = "")}
  <div class="row" {title}><label>{label}</label>
    <input type="range" {min} {max} {step} use:field={() => R(l)[key] ?? 0} oninput={e => { l[key] = +val(e); live(); }} onchange={() => done()} />
    <span class="val">{fmt(R(l)[key] ?? 0)}</span></div>
{/snippet}
{#snippet select(label: string, opts: Opt[], value: unknown, pick: (v: string) => void)}
  <div class="row"><label>{label}</label>
    <select use:field={() => String(value ?? "")} onchange={e => pick(val(e))}>
      {#each opts as [v, t] (v)}<option value={String(v)}>{t}</option>{/each}
    </select></div>
{/snippet}
{#snippet color(label: string, key: string)}
  <div class="row"><label>{label}</label>
    <input type="color" use:field={() => R(l)[key] || "#000000"} oninput={e => { l[key] = val(e); live(); }} onchange={() => done()} /></div>
{/snippet}
{#snippet area()}
  <div class="section">Area</div>
  {@render select("Clip to", clipOpts(), R(l).clip || "", v => put(l, "clip", v || null))}
  <div class="btnrow">
    <button disabled={!hasSel()} title="Keep the effect only inside the current selection" onclick={() => regionFromSelection(l)}>Use selection</button>
    <button disabled={!hasSel()} title="Move and size the layer to the selection and use it as the area" onclick={() => fitToSelection(l)}>Fit to selection</button>
    {#if R(l).region}<button onclick={() => clearRegion(l)}>Whole box</button>{/if}
    {#if R(l).erase?.length}<button title="Bring back what the eraser (E) took out" onclick={() => put(l, "erase", [], "Erasing cleared")}>Clear erasing</button>{/if}
  </div>
  <p class="hint">{R(l).region ? "Shown only inside its selected area." : "Fills its whole box."} The tone eraser (E) rubs parts out.</p>
{/snippet}

{#if R(l).type === "tone"}
  <div class="btnrow"><button onclick={() => showLib("tones")}>Tone library…</button><button onclick={saveTone}>Save to library</button></div>
  {@render select("Dots", SHAPES, R(l).shape, v => put(l, "shape", v))}
  {#if R(l).shape === "tile"}
    <div class="row"><label>Tile</label><input style="flex:1" placeholder="image ref (Library › Uploads)" use:field={() => R(l).tile || ""} onchange={e => put(l, "tile", val(e) || null)} /></div>
    {@render slider("Tile scale", "tileScale", 0.1, 4, 0.05, v => (+v).toFixed(2) + "×")}
  {:else}
    {@render slider("Lines/inch", "lpi", 10, 85, 0.5, v => v + " L", "Screen ruling: 50–65 L is the usual manga range; lower is coarser")}
  {/if}
  {#if !R(l).grad}{@render slider("Density", "pct", 1, 100, 1, pct)}{/if}
  {#if R(l).shape !== "flat"}{@render slider("Angle", "angle", 0, 180, 1, v => v + "°")}{/if}
  {@render color("Color", "color")}
  {#if ["noise", "cloud", "sparkle", "stars"].includes(R(l).shape)}<div class="btnrow"><button onclick={reseed}>Reshuffle</button></div>{/if}

  <div class="section">Gradient</div>
  {@render select("Kind", [["none", "None"], ["linear", "Linear"], ["radial", "Radial"]], R(l).grad?.kind || "none", setGrad)}
  {#if R(l).grad}
    {#each stops() as s, i (i)}
      <div class="row stop"><label>{i === 0 ? "Stops" : ""}</label>
        <input type="range" min="0" max="1" step="0.01" title="Position along the gradient" value={s[0]} oninput={e => setStop(i, 0, +val(e))} onchange={e => setStop(i, 0, +val(e), true)} />
        <input type="range" min="0" max="100" step="1" title="Tone density at this stop" value={s[1]} oninput={e => setStop(i, 1, +val(e))} onchange={e => setStop(i, 1, +val(e), true)} />
        <span class="val">{Math.round(s[1])}%</span>
        <button class="x" title="Remove stop" disabled={stops().length <= 2} onclick={() => dropStop(i)}>×</button></div>
    {/each}
    <div class="btnrow"><button onclick={addStop}>Add stop</button><button onclick={flip}>Reverse</button></div>
    <p class="hint">Drag the white (start) and black (end) handles on the page; Shift snaps to 45°. Dot size follows the density, like a printed halftone gradient.</p>
  {/if}
  {@render area()}
{:else}
  {@const m = R(l).mode}
  {@render select("Kind", MODES, m, v => put(l, "mode", v))}
  {@render slider("Lines", "count", 6, 600, 1)}
  {@render slider("Thickness", "thick", 1, 80, 0.5)}
  {@render slider("Taper", "taper", 0, 1, 0.01, v => pct(v * 100), "How sharply each line narrows to a point")}
  {@render slider(m === "parallel" ? "Gap" : "Empty centre", "inner", 0, 1.5, 0.01, v => pct(v * 100))}
  {@render slider("Length jitter", "jitter", 0, 1, 0.01, v => pct(v * 100))}
  {@render slider("Spacing jitter", "spread", 0, 1, 0.01, v => pct(v * 100), "0 spaces the lines evenly, 100% scatters them")}
  {#if m === "parallel"}{@render slider("Direction", "angle", -90, 90, 1, v => v + "°")}{/if}
  {#if m === "uni"}{@render slider("White outline", "outline", 0, 12, 0.5)}{/if}
  {@render color("Color", "color")}
  {#if m === "beta" || m === "uni"}
    <div class="row"><label>Centre fill</label>
      <input type="checkbox" checked={!!R(l).fill} onchange={e => put(l, "fill", (e.currentTarget as HTMLInputElement).checked ? "#ffffff" : null)} />
      {#if R(l).fill}<input type="color" use:field={() => R(l).fill} oninput={e => { l.fill = val(e); live(); }} onchange={() => done()} />{/if}</div>
  {/if}
  {#if m !== "parallel"}
    <div class="btnrow">
      <button onclick={() => put(l, "center", [0.5, 0.5], "Centre reset")}>Centre</button>
      {#if R(l).innerPts?.length}<button onclick={() => put(l, "innerPts", null, "Empty centre is an ellipse")}>Ellipse centre</button>
      {:else}<button title="Turn the empty centre into points you can drag" onclick={() => { makeInnerEditable(l); done("Empty centre editable"); }}>Edit centre shape</button>{/if}
      <button onclick={reseed}>Reshuffle</button>
    </div>
    <p class="hint">With Move, drag the pink diamond to aim the lines and the orange ring (or points) to shape the empty centre.</p>
  {:else}
    <div class="btnrow"><button onclick={reseed}>Reshuffle</button></div>
  {/if}
  {@render area()}
{/if}

<style>
  .stop input[type=range] { flex: 1; min-width: 0; }
  .x { padding: 0 6px; }
</style>
