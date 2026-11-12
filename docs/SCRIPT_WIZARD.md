# Script Wizard guide

The Script Wizard turns a scene written as plain lines into manga pages: it picks a layout for each
page, draws the panels, letters the dialogue in reading order, and creates one **shot** per panel (its
characters and render prompt), ready to pose and render.

Open it with the blue **✎ Script Wizard** button in the top bar (or File › Script Wizard…, ⌘⇧K). Paste
or type the script on the left; the preview on the right shows the pages as you type.

## The format

One thing per line. Blank lines are ignored.

| line | means |
|---|---|
| `[Rem, Subaru] Classroom at sunset, both smiling` | **a new panel**. `[…]` lists who is in it, left to right as they stand in the frame; the rest is the render prompt (place, action, expression, camera). |
| `! [Rem] Rem slams the door` | `!` first makes it a **big panel** (a row of its own, taller): use it for the moment the page builds to. |
| `Rem: He said he'd come...` | **speech** (oval bubble), tail toward Rem. |
| `Rem (thought): Maybe he forgot.` | **thought** (cloud bubble). |
| `Subaru (shout): Sorry I'm late!` | **shout** (burst). A line ending in `!!` or written in CAPITALS is a shout too. |
| `Ram (whisper): Honestly...` | **whisper** (dashed bubble). |
| `Caption: The next day.` | a caption box (time, place, narration) in the panel's corner. |
| `SFX: BAM` | a sound effect across the panel. |
| `Title: MY FIRST MANGA` | a big title on the page (covers, chapter openers). |
| `---` | **new page**. Pages also split automatically after *Panels / page* (6 by default). |
| `# 4-koma` | this page is a four-panel strip (four equal rows). Any other `#` line is a note and is ignored. |

Dialogue belongs to the panel above it. A line of dialogue before any panel starts a panel of its own.
A name used in dialogue that is not in the panel's `[…]` is added to it.

### Example

```text
Title: CHAPTER 1
[Rem] Classroom after school, sunset through the windows, Rem waits by the door, looking at viewer.
Rem: He said he'd come...
Rem (thought): Maybe he forgot.
SFX: TAP TAP
[Subaru] School hallway, Subaru running, out of breath, dynamic angle.
Subaru (shout): Rem! Sorry I'm late!
! [Rem, Subaru] Classroom at sunset, Rem turns around surprised and happy, Subaru scratching his head.
Rem: Subaru-kun!
---
# 4-koma
[Mika] Mika at her desk, staring at an empty notebook.
Mika: Today I'll finally draw my manga!
[Mika] Mika sketching furiously, papers everywhere.
SFX: SCRIBBLE SCRIBBLE
[Mika] Mika holds up a page proudly, sparkles.
Mika (shout): DONE!!
[Mika, Cat] The cat asleep on the finished page, Mika in shock.
Mika: ...Hey.
```

## Options in the dialog

- **Template**: start from a 4-koma, dialogue page, action page or cover.
- **Pages**: replace the project, or add the new pages after the last one.
- **Reading**: right to left (manga) or left to right. Panels, bubbles and captions follow it.
- **Panels / page**: where long scenes split into pages.
- **Shots**: one shot per panel named `<prefix>_pNN_K` (page, panel in reading order). Untick to
  get only the layout and lettering.
- **Series**: added to every character that has none (it helps the LoRA search).

## What happens to the characters

Each name in `[…]` becomes a character in the panel's shot, in that order, left to right. If the
**character sheet** (Pipeline › Character sheet) knows the name, the shot gets its series, LoRA,
looks, girl/boy and, for single-character shots, its reference sheet. Otherwise the LoRA is looked up
on Civitai by name and series when the shot renders.

## After building

1. Each panel has a shot. Select a panel and click **Pose…**: the Pose tab opens at the panel's
   shape with its characters and prompt. Pick poses (or a shot preset), **Save & render**.
2. Renders land in their panels. Double-click a panel to reposition its render.
3. Fix lettering by double-clicking a bubble; drag the tail tip toward the speaker.
4. **Page › Check this page** finds bubbles out of reading order, tails pointing away, text too small
   to print and anything outside the safe area, with one-click fixes.
5. **File › Export all pages + PDF**.

## Writing scripts that work

- **One beat per panel.** A panel is one moment: one action, at most 2–3 lines of dialogue.
- **Pace the page.** 4–6 panels; one big panel (`!`) for the moment the page builds to, usually last
  or in the middle. End a page on a hook so the reader turns it.
- **Prompts describe the picture, not the story**: place, time of day, what each character is doing,
  expression, camera (close-up, from above, wide shot). Danbooru-style tags work well: `classroom,
  sunset, smiling, looking at viewer, from below`.
- **Order the names left to right** as they stand in the picture; the dialogue tails and the render's
  per-character regions follow that order.
- **Keep lines short.** Under ~100 characters per bubble; split long speeches into two bubbles.
- **Captions for time and place**, SFX for sound: short words read best (BAM, DOKI DOKI, ゴゴゴ).
- **Name characters consistently** (same spelling every time) so the character sheet and LoRA match.
- **At most 3 characters per panel**; past that, renders lose who is who.

## From Claude (MCP)

`./mangamaker-mcp` serves the same pipeline to Claude: `script_format`, `check_script`,
`build_pages_from_script`, `list_poses`, `pose_shot`, `render_shot`, `place_renders`, `pod`, `cast`.
The repo's `.mcp.json` registers it for Claude Code; the `kks-mangamaker-script` skill
(`.claude/skills/`) writes scripts in this format.
