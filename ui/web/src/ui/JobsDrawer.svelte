<script lang="ts">
  import { ui } from "./store.svelte.ts";
  import { closeJob, toggleJobs, viewJob } from "../editor/jobs.js";

  let pre = $state<HTMLPreElement>();
  // keep the log pinned to its end while it grows, unless the reader scrolled up
  let pinned = true;
  const onscroll = () => { if (pre) pinned = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20; };
  $effect(() => { ui.jobLog; if (pre && pinned) pre.scrollTop = pre.scrollHeight; });
  const MARK = { run: "… ", ok: "✓ ", bad: "⚠ " };
  const TIP = { run: "Running", ok: "Finished", bad: "Failed: click to read the log" };
</script>

<div id="jobsdrawer" hidden={!ui.jobsOpen}>
  <div class="drawerhead">Jobs <button class="ghost" title="Close the jobs log" onclick={() => toggleJobs(false)}>✕</button></div>
  <div id="joblist">
    {#each ui.jobs as j (j.id)}
      <span class="jobchip {j.state}" class:on={j.id === ui.jobView}>
        <button class="jl" title={TIP[j.state]} onclick={() => viewJob(j.id)}>{MARK[j.state]}{j.label}</button>
        <!-- status is a mark, never a cross: the cross on the right is the one that closes the job -->
        <button class="jx" aria-label="Close job" title={j.state === "run" ? "Stop this job and remove it" : "Remove from this list"}
          onclick={() => closeJob(j.id)}>✕</button>
      </span>
    {:else}
      <span class="hint">No jobs yet. Renders and pod commands show their log here.</span>
    {/each}
  </div>
  <pre id="joblog" bind:this={pre} {onscroll}>{ui.jobs.length ? ui.jobLog || "starting…" : ""}</pre>
</div>
