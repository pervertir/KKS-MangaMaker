<script lang="ts">
  /* Properties: the selected layer's settings, or the page's when nothing is selected. The document is
     plain data owned by the editor (src/editor/state.ts); every read goes through sel()/doc(), which
     depend on ui.rev, so the fields follow drags, undo and edits made elsewhere without being rebuilt
     (focus stays where it is). */
  import { ui } from "./store.svelte.ts";
  import { act } from "../editor/actions.js";
  import { enterAdjust } from "../editor/adjust.js";
  import { setPanelImage } from "../editor/creation.js";
  import { showLib } from "../editor/dock-tabs.js";
  import { commit } from "../editor/history.js";
  import { thumb } from "../editor/images.js";
  import { renderShot } from "../editor/jobs.js";
  import { layoutDialog } from "../editor/layouts.js";
  import { VSHAPES } from "../editor/manga-tools.js";
  import { refreshPanels } from "../editor/misc.js";
  import { shotDialog } from "../editor/shots.js";
  import { S, bubbleMeta, layers, page, selL } from "../editor/state.ts";
  import { FONTS, LAZY_FONTS, loadFontCss } from "../editor/text.js";
  import { TONE_PRESETS } from "../editor/tools.js";
  import { panelOrder, requestDraw } from "../editor/view.js";
  import { poseForPanel } from "../pose/open.js";
  import { clearLayer, counts, recolor, smoothing, widen } from "../draw/edit.ts";

  type Obj = Record<string, any>;
  type Opt = [string | number, string];
  type Fmt = (v: number) => string | number;

  const sel = (): Obj | null => (ui.rev, S.doc ? selL() : null);
  const doc = (): Obj | null => (ui.rev, S.doc);
  const shots = (): Obj[] => (ui.rev, S.shots || []);

  const TITLES: Record<string, (l: Obj) => string> = {
    panel: () => "Panel", bubble: () => "Speech bubble", caption: () => "Caption", text: l => l.sfx ? "Sound effect" : "Text",
    image: () => "Image", vbubble: () => "Drawn bubble", tone: () => "Screentone", speed: l => l.mode === "focus" ? "Focus lines" : "Speed lines",
    raster: () => "Paint", vector: () => "Line art",
  };
  $effect(() => {
    const l = sel(), t = document.getElementById("propstitle");
    if (t) t.textContent = l ? TITLES[l.type]?.(l) ?? "Layer" : `Page ${S.page + 1}`;
  });

  /* A read that is repeated whenever the document changes (snippets receive the same object each time). */
  const R = <T,>(o: T): T => (ui.rev, o);
  /* use:field={() => value}: keeps a control showing the document's value. Written here instead of as a
     value attribute because the document also changes behind the control (undo, dragging on the page),
     and a control being typed in is left alone. */
  type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  function field(el: Field, get: () => unknown) {
    $effect(() => {
      ui.rev;
      const v = String(get() ?? "");
      const typing = document.activeElement === el && (el instanceof HTMLTextAreaElement || ["text", "number"].includes(el.type));
      if (el.value !== v && !typing) el.value = v;
    });
  }
  function tick(el: HTMLInputElement, get: () => unknown) {
    $effect(() => { ui.rev; el.checked = !!get(); });
  }
  const r2 = (v: number) => Math.round((v ?? 0) * 100) / 100;
  const live = () => { requestDraw(); ui.rev++; };                              // while a slider or colour is being dragged
  const done = (msg?: string) => { commit(msg); requestDraw(); };               // one undo step
  const put = (o: Obj, k: string, v: unknown, msg?: string) => { o[k] = v; done(msg); };
  const val = (e: Event) => (e.currentTarget as HTMLInputElement).value;
  const on = (e: Event) => (e.currentTarget as HTMLInputElement).checked;
  const pct: Fmt = v => Math.round(v * 100) + "%";
  const lazyFonts = () => Object.keys(LAZY_FONTS).forEach(loadFontCss);        // fetch the faces when the list opens

  const BLENDS: Opt[] = [["source-over", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"], ["lighten", "Lighten"], ["difference", "Difference"]];
  const PATTERNS: Opt[] = [["dots", "Dots (amitone)"], ["lines", "Lines"], ["cross", "Crosshatch"], ["noise", "Sand / noise"], ["solid", "Flat"]];
  const FADES: Opt[] = [["none", "None"], ["down", "Fade downward"], ["up", "Fade upward"], ["right", "Fade to the right"], ["left", "Fade to the left"], ["edges", "Dark edges (vignette)"], ["center", "Dark centre"]];
  const clipOpts = (): Opt[] => [["", "— none —"], ...panelOrder(layers()).map((q: Obj, i: number): Opt => [q.id, `Panel ${i + 1}${q.shot ? " · " + q.shot : ""}`])];
  const reseed = (l: Obj) => put(l, "seed", Math.floor(Math.random() * 1e6), "Reshuffled");

  function pickShot(l: Obj, name: string) {
    l.shot = name;
    const s = S.shots.find((q: Obj) => q.name === name);
    if (s?.renders[0]) setPanelImage(l, s.renders[0], name); else { l.image = null; done(); }
  }
  function autoColor(e: Event, o: Obj, k: string) {
    const c = (e.currentTarget as HTMLElement).closest(".row")!.querySelector<HTMLInputElement>("input[type=color]")!;
    put(o, k, on(e) ? "auto" : c.value);
  }
  function tonePreset(e: Event, l: Obj) {
    const s = e.currentTarget as HTMLSelectElement;
    if (s.value !== "") { Object.assign(l, TONE_PRESETS[+s.value][1]); done("Tone preset"); }
    s.value = "";
  }
</script>

{#snippet num(label: string, o: Obj, key: string)}
  <label>{label}<input type="number" step="1" data-k={key} use:field={() => r2(R(o)[key])} onchange={e => put(o, key, +val(e))} /></label>
{/snippet}

{#snippet slider(label: string, o: Obj, key: string, min: number, max: number, step: number, fmt: Fmt = v => v, def = 0)}
  <div class="row"><label>{label}</label>
    <input type="range" {min} {max} {step} use:field={() => R(o)[key] ?? def} oninput={e => { R(o)[key] = +val(e); live(); }} onchange={() => commit()} />
    <span class="val">{fmt(R(o)[key] ?? def)}</span></div>
{/snippet}

{#snippet check(label: string, o: Obj, key: string)}
  <label class="inl"><input type="checkbox" use:tick={() => !!R(o)[key]} onchange={e => put(o, key, on(e))} />{label}</label>
{/snippet}

{#snippet color(label: string, o: Obj, key: string, auto = false)}
  <div class="row"><label>{label}</label>
    <input type="color" use:field={() => R(o)[key] === "auto" ? "#111111" : R(o)[key] || "#000000"} oninput={e => { R(o)[key] = val(e); live(); }} onchange={() => commit()} />
    {#if auto}<label class="inl"><input type="checkbox" use:tick={() => R(o)[key] === "auto"} onchange={e => autoColor(e, o, key)} />auto</label>{/if}
  </div>
{/snippet}

{#snippet select(label: string, opts: Opt[], value: unknown, pick: (v: string) => void, open?: () => void)}
  <div class="row"><label>{label}</label>
    <select use:field={() => String(value ?? "")} onchange={e => pick(val(e))} onpointerdown={open}>
      {#each opts as [v, t] (v)}<option value={String(v)}>{t}</option>{/each}
    </select></div>
{/snippet}

{#snippet words(l: Obj)}
  <textarea class="big" placeholder="Dialogue… (double-click the bubble to type on the page)" use:field={() => R(l).text || ""}
    oninput={e => { R(l).text = val(e); requestDraw(); }} onchange={() => commit("Text edited")}></textarea>
{/snippet}

{#snippet fonts(l: Obj)}
  {@render select("Font", FONTS as Opt[], R(l).font || "MMComic", v => put(l, "font", v), lazyFonts)}
  <div class="row"><label>Size</label>
    <input type="number" min="0" style="width:56px" title="Text size in page px; 0 fits the text to its box" use:field={() => R(l).fontSize || 0} onchange={e => put(l, "fontSize", +val(e))} />
    {@render check("Bold", l, "bold")}{@render check("Italic", l, "italic")}<span class="hint">0 = fit</span></div>
{/snippet}

{#snippet clip(l: Obj)}
  {@render select("Clip to", clipOpts(), R(l).clip || "", v => put(l, "clip", v || null))}
{/snippet}

{#snippet panel(l: Obj)}
  {@const shot = shots().find(s => s.name === R(l).shot)}
  <div class="section">Shot</div>
  {@render select("Shot", [["", "— none —"], ...shots().map((s): Opt => [s.name, s.name + (s.renders.length ? "" : " (no render)")])], R(l).shot || "", v => pickShot(l, v))}
  {#if shot && (shot.renders.length || shot.finals.length)}
    <div class="renders">
      {#each [...shot.renders, ...shot.finals] as ref (ref)}
        <img src={thumb(ref, 160)} class:on={R(l).image?.ref === ref} title={ref.split("/").pop()} alt="" onclick={() => setPanelImage(l, ref, shot.name)} />
      {/each}
    </div>
  {/if}
  <div class="btnrow">
    <button onclick={() => shotDialog(R(l).shot || null)}>Edit shot…</button>
    <button title="Pose the characters for this panel (no game needed)" onclick={() => poseForPanel(l)}>Pose…</button>
    {#if R(l).shot}<button class="primary" onclick={() => renderShot(R(l).shot)}>Render on pod</button>{/if}
  </div>
  {#if R(l).image}
    <div class="section">Render in panel</div>
    {@render select("Fit", [["cover", "Cover (crop)"], ["contain", "Contain"]], R(l).image.fit, v => { R(l).image.fit = v; R(l).image.zoom = 1; done(); })}
    {@render slider("Zoom", R(l).image, "zoom", R(l).image.fit === "contain" ? 0.2 : 1, 5, 0.01, v => v.toFixed(2) + "×", 1)}
    <div class="btnrow">
      {@render check("Flip", R(l).image, "flip")}{@render check("B/W", R(l).image, "gray")}
      <button onclick={() => enterAdjust(l)}>Reposition (Enter)</button>
      <button onclick={() => { R(l).image = null; commit("Image removed"); requestDraw(); refreshPanels(); }}>Remove image</button>
    </div>
  {/if}
  <div class="section">Frame</div>
  <div class="row"><label>Border</label>
    <input type="number" min="0" style="width:64px" use:field={() => R(l).border} onchange={e => put(l, "border", +val(e))} />
    <input type="color" use:field={() => R(l).borderColor} oninput={e => { R(l).borderColor = val(e); live(); }} onchange={() => commit()} />
    <span class="hint">fill</span>
    <input type="color" use:field={() => R(l).fill} oninput={e => { R(l).fill = val(e); live(); }} onchange={() => commit()} /></div>
  <div class="btnrow"><button onclick={() => act.split("v")}>Split ⇆</button><button onclick={() => act.split("h")}>Split ⇅</button></div>
{/snippet}

{#snippet pageProps(d: Obj)}
  <div class="row"><label>Title</label><input style="flex:1" use:field={() => R(d).title} onchange={e => { R(d).title = val(e); commit(); }} /></div>
  {@render select("Reading", [["rtl", "Right to left (manga)"], ["ltr", "Left to right"]], R(d).reading, v => put(d, "reading", v))}
  {@render color("Paper", (ui.rev, page()), "bg")}
  <div class="row"><label>Max text</label><input type="number" use:field={() => R(d).maxFont} onchange={e => put(d, "maxFont", +val(e))} />
    <span class="hint">px, keeps fitted text even</span></div>
  <div class="btnrow"><button onclick={layoutDialog}>Choose layout…</button></div>
  <p class="hint">Pick a layout, drag renders from the Library onto panels, then letter the page with bubbles, text and sound effects.</p>
{/snippet}

{#if !sel()}
  {#if doc()}{@render pageProps(doc()!)}{/if}
{:else}
  {#key sel()!.id}
    {@const type = sel()!.type}
    <div class="grid4">{@render num("X", sel()!, "x")}{@render num("Y", sel()!, "y")}{@render num("W", sel()!, "w")}{@render num("H", sel()!, "h")}</div>
    {#if type !== "panel"}
      <div class="row"><label>Rotate</label>
        <input type="number" step="1" data-k="rotate" use:field={() => r2(sel()!.rotate || 0)} onchange={e => put(sel()!, "rotate", +val(e))} />
        <span class="hint">°  Shift snaps 15°</span></div>
    {/if}

    {#if type === "panel"}
      {@render panel(sel()!)}
    {:else if type === "bubble"}
      {@const m = bubbleMeta(sel()!.bubble)}
      {@render words(sel()!)}
      <div class="row"><label>Template</label>
        <img src={thumb(m.ref, 120)} alt="" style="height:44px;background:#e9e9ec;border-radius:4px;padding:2px" />
        <button onclick={() => showLib("bubbles")}>#{m.key} · change…</button></div>
      {@render fonts(sel()!)}
      {@render color("Text color", sel()!, "color", true)}
      <div class="btnrow">{@render check("Flip tail", sel()!, "flip")}{@render check("Vertical text", sel()!, "vertical")}</div>
    {:else if type === "caption"}
      {@render words(sel()!)}
      {@render fonts(sel()!)}
      {@render color("Text color", sel()!, "color", true)}
      {@render color("Fill", sel()!, "fill")}
      <div class="row"><label>Border</label><input type="number" min="0" use:field={() => sel()!.borderW} onchange={e => put(sel()!, "borderW", +val(e))} /></div>
    {:else if type === "text"}
      {@render words(sel()!)}
      {@render fonts(sel()!)}
      {@render color("Color", sel()!, "color")}
      {@render color("Outline", sel()!, "stroke")}
      {@render slider("Outline w", sel()!, "strokeWidth", 0, 40, 1)}
      {@render select("Align", [["center", "Center"], ["left", "Left"], ["right", "Right"]], sel()!.align || "center", v => put(sel()!, "align", v))}
      <div class="btnrow">{@render check("Vertical (tategaki)", sel()!, "vertical")}</div>
    {:else if type === "image"}
      <div class="btnrow">{@render check("Flip", sel()!, "flip")}</div>
    {:else if type === "vbubble"}
      {@const shape = sel()!.shape}
      {@render words(sel()!)}
      {@render select("Shape", VSHAPES as Opt[], shape, v => put(sel()!, "shape", v))}
      {@render fonts(sel()!)}
      {@render color("Text color", sel()!, "color", true)}
      <div class="row"><label>Fill / line</label>
        <input type="color" use:field={() => sel()!.fill} oninput={e => { sel()!.fill = val(e); live(); }} onchange={() => commit()} />
        <input type="color" use:field={() => sel()!.stroke} oninput={e => { sel()!.stroke = val(e); live(); }} onchange={() => commit()} />
        <input type="number" min="0" style="width:56px" title="line width" use:field={() => sel()!.strokeW} onchange={e => put(sel()!, "strokeW", +val(e))} /></div>
      {@render slider("Tail width", sel()!, "tailW", 0.05, 0.6, 0.01, v => v.toFixed(2))}
      {#if ["burst", "flash"].includes(shape)}{@render slider("Spikes", sel()!, "spikes", 6, 48, 1)}{/if}
      <div class="btnrow">
        <button onclick={() => { const l = sel()!; put(l, "tail", l.tail ? null : { x: -l.w * 0.18, y: l.h * 0.85 }); }}>{sel()!.tail ? "Remove tail" : "Add tail"}</button>
        {#if ["cloud", "burst", "flash"].includes(shape)}<button onclick={() => reseed(sel()!)}>Reshuffle</button>{/if}
        {@render check("Vertical text", sel()!, "vertical")}
      </div>
      <p class="hint">Drag the pink dot to aim the tail.</p>
    {:else if type === "tone"}
      <div class="row"><label>Preset</label>
        <select onchange={e => tonePreset(e, sel()!)}>
          <option value="">— apply a preset —</option>
          {#each TONE_PRESETS as [t], i (i)}<option value={i}>{t}</option>{/each}
        </select></div>
      {@render select("Pattern", PATTERNS, sel()!.pattern, v => put(sel()!, "pattern", v))}
      {@render slider("Cell size", sel()!, "size", 3, 40, 1, v => v + "px")}
      {@render slider("Density", sel()!, "density", 0.02, 1, 0.01, pct)}
      {@render slider("Angle", sel()!, "angle", 0, 180, 1, v => v + "°")}
      {@render select("Gradient", FADES, sel()!.fade, v => put(sel()!, "fade", v))}
      {@render color("Color", sel()!, "color")}
      {@render clip(sel()!)}
      {#if sel()!.pattern === "noise"}<div class="btnrow"><button onclick={() => reseed(sel()!)}>Reshuffle</button></div>{/if}
    {:else if type === "speed"}
      {@const focus = sel()!.mode === "focus"}
      {@render select("Kind", [["focus", "Focus lines (集中線)"], ["parallel", "Speed lines (流線)"]], sel()!.mode, v => put(sel()!, "mode", v))}
      {@render slider("Lines", sel()!, "count", 10, 600, 1)}
      {@render slider("Thickness", sel()!, "thick", 1, 60, 0.5)}
      {@render slider(focus ? "Empty centre" : "Gap", sel()!, "inner", 0, 0.95, 0.01, pct)}
      {@render slider("Jitter", sel()!, "jitter", 0, 1, 0.01, pct)}
      {#if !focus}{@render slider("Direction", sel()!, "angle", -90, 90, 1, v => v + "°")}{/if}
      {@render color("Color", sel()!, "color")}
      {@render clip(sel()!)}
      <div class="btnrow"><button onclick={() => reseed(sel()!)}>Reshuffle</button></div>
    {:else if type === "raster"}
      {@render clip(sel()!)}
      <div class="btnrow"><button class="danger" onclick={() => clearLayer(sel()!)}>Clear paint</button></div>
    {:else if type === "vector"}
      {@const n = counts(R(sel()!))}
      <div class="hint">{n.strokes} line{n.strokes === 1 ? "" : "s"}{n.fills ? `, ${n.fills} fill${n.fills === 1 ? "" : "s"}` : ""}. Lines keep their pen samples: change them here any time.</div>
      <div class="row"><label>Colour</label>
        <input type="color" value="#000000" onchange={e => recolor(sel()!, val(e), "lines")} title="Recolour every line" />
        <button onclick={e => recolor(sel()!, (e.currentTarget as HTMLElement).parentElement!.querySelector("input")!.value, "fills")}>Fills too</button></div>
      <div class="btnrow"><button onclick={() => widen(sel()!, 0.8)}>Thinner</button><button onclick={() => widen(sel()!, 1.25)}>Thicker</button></div>
      <div class="row"><label>Smoothing</label>
        <input type="range" min="0" max="1" step="0.05" value="0.6" onchange={e => smoothing(sel()!, +val(e))} /></div>
      {@render clip(sel()!)}
      <div class="btnrow"><button class="danger" onclick={() => clearLayer(sel()!)}>Clear lines</button></div>
    {/if}

    <div class="section">Layer</div>
    {@render slider("Opacity", sel()!, "opacity", 0, 1, 0.01, pct, 1)}
    {@render select("Blend", BLENDS, sel()!.blend || "source-over", v => put(sel()!, "blend", v))}
    <div class="btnrow"><button onclick={act.duplicate}>Duplicate</button><button class="danger" onclick={act.remove}>Delete</button></div>
  {/key}
{/if}

<style>
  .inl { display: flex; gap: 5px; align-items: center; color: var(--muted); }
</style>
