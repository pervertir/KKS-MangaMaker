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

### Colours in the editor

The script box colours each line the way it will be read, using the same rules that build the pages,
so a line in the wrong colour is a line the wizard understands differently from what you meant:

| colour | what it is |
|---|---|
| white | the picture prompt of a panel |
| blue | names: the `[…]` cast list and the speaker of a line |
| pink `!` | a big panel |
| green / lavender / orange / grey | speech / thought / shout / whisper (a line that shouts because of `!!` or CAPITALS turns orange too) |
| purple | the `Title`, `Caption`, `SFX` keywords |
| sand / pink / yellow | caption text / sound effect / title |
| amber `---` | a page break |
| teal | the `4-koma` directive; other `#` notes are grey |

The margin shows `page·panel` (for example `1·2`) on every line that starts a panel, after the automatic
page split, and the line number elsewhere. Parts underlined in amber are soft warnings, listed under the
box (click one to jump to its line): more than 3 characters in a panel, more than 3 lines of dialogue in
a panel, a bubble over 120 characters, a panel with no prompt and nobody in it. They never block
**Build pages**. A typical slip the colours catch: `Classroom: sunset` is blue and green because a few
words and a colon read as dialogue; write `[] Classroom, sunset` for a panel with nobody in it.

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

## Converting an existing script with any LLM

A story, an outline, a prose chapter, a screenplay or a comic script in another format can be turned
into this format by any chat model. In the Script Wizard click **Copy LLM prompt**:

1. Optionally paste the source into the box (otherwise the prompt ends with a
   `PASTE YOUR SCRIPT BELOW THIS LINE` marker and you paste the source after it in the chat).
2. Set the reading direction, panels per page, the character names to keep (filled from the character
   sheet), the language to keep and a content rating or tone. They are written into the prompt.
3. **Copy prompt**, paste it into the chat, send.
4. Copy the answer and paste it into the script box, or use **Paste result**. A surrounding code fence
   (with or without a language tag such as `text`) is removed on paste.
5. Read the colours and the warnings under the box, fix what is underlined, **Build pages**.

The prompt with the default options (right to left, 6 panels per page, no names given):

````text
You are a manga script adapter. Convert the SOURCE at the end of this message into a manga script in the exact plain-text format described below. The source may be a story, an outline, a prose chapter, a screenplay, or a comic script written in some other format. A program reads your output line by line and turns it into pages, panels, lettered speech bubbles and one picture prompt per panel for an image generator, so the syntax has to be exact.

# FORMAT

One item per line. Blank lines are ignored. These are the only line types:

[Name, Name] picture prompt
    PANEL. Starts a new panel. The square brackets list every character visible in it, separated by commas, in left-to-right order as they stand in the frame. Everything after "]" is the picture prompt of that panel. A panel with nobody in it (scenery, an object) has empty brackets: [] picture prompt
! [Name, Name] picture prompt
    BIG PANEL. A panel line with "!" in front gets a full-width, taller row.
Name: text
    SPEECH (oval bubble) said by Name.
Name (thought): text
    THOUGHT (cloud bubble).
Name (shout): text
    SHOUT (spiky bubble).
Name (whisper): text
    WHISPER (dashed bubble).
Caption: text
    CAPTION. A narration box in the corner of the panel: time, place, short narration.
SFX: TEXT
    SOUND EFFECT lettered across the panel. Short and in capitals: BAM, TAP TAP, DOKI DOKI.
Title: TEXT
    TITLE. A big title on the page it is written in (chapter openers and covers only).
---
    PAGE BREAK. Three hyphens alone on a line; the next panel starts a new page.
# 4-koma
    FOUR-PANEL STRIP. Alone on a line at the top of a page: that page becomes four equal panels stacked top to bottom. Write exactly four panels for it.
# any other text
    NOTE. Ignored by the program. Do not write notes unless the source asks for them.

# PARSING RULES

- Speech, thought, shout, whisper, Caption and SFX lines belong to the panel line above them. Write the panel line first, then its lines in the order they are read.
- Start every panel line with "[" (or "! [" for a big panel). A line that starts with a few words and a colon is read as dialogue, never as a panel.
- A name is 1 to 4 words, at most 40 characters, without colons, square brackets or exclamation marks. Spell each character's name identically every time, in the brackets and in dialogue (always "Rem", never "Rem" in one place and "Rem-chan" in another). The name before the colon is a label and is not printed in the bubble.
- The only moods are (thought), (shout) and (whisper), written between the name and the colon. Put nothing else in parentheses there: acting directions such as (smiling) or (to Ken) belong in the picture prompt.
- The order of the names in the brackets is their left-to-right order in the picture. Bubble tails and the image generator both rely on it.
- A speaker who is missing from the panel's brackets is added at the right end and drawn, so list every speaker yourself, in the right position. For a voice from outside the frame, use a Caption or give the speaker a panel.
- Speech that ends in "!!" or is written entirely in CAPITALS becomes a shout by itself. Only write speech that way when it is shouted.
- "---" starts a new page. Aim for 4 to 6 panels per page. A page with more than 6 panels is split after every 6 panels, wherever that falls, so place every page break yourself.
- "# 4-koma" and "Title:" apply to the page they are written in; put them right after the "---" that opens the page.
- Every item stays on one line: never wrap a bubble or a picture prompt over several lines.
- Write no "Page 1", "Panel 2", scene headings, numbering, speaker lists or stage directions on lines of their own. Any line that is not one of the types above becomes an unwanted panel.

# PICTURE PROMPTS

The picture prompt describes one frozen image, not the story. It goes to an anime image generator.
- Say where and when (place, time of day, lighting), what each listed character is doing (pose, action), their expression, and the camera (close-up, upper body, full body, wide shot, from above, from below, from behind, dynamic angle).
- Write it in English as short comma-separated phrases. Danbooru-style tags work best: classroom, sunset, sitting at desk, smiling, looking at viewer, from below.
- No dialogue, no quoted words, no sound effects, no thoughts, no backstory, nothing that happens before or after this instant.
- Names may be used to say who does what. Fixed looks (hair, eyes, usual outfit) are not needed; mention clothing or props only when they matter in this panel.
- Show the place in the first panel of each scene, then change the camera from panel to panel.

# PACING

- One beat per panel: one moment, one action.
- 4 to 6 panels per page, with at most one big panel ("!") for the moment the page builds to, usually last or in the middle. End each page on a hook so the reader turns it.
- In long conversations alternate between the speakers' faces and add reaction panels; a panel with no dialogue at all is fine.
- Captions carry time and place. SFX carry sound.
- The pages are read right to left (manga). This changes nothing in how you write: panels in story order, names in left-to-right frame order.

# HARD LIMITS

- At most 3 characters in a panel. For a crowd, list who matters and put "crowd in the background" in the picture prompt.
- At most 3 dialogue lines (speech, thought, shout, whisper) in a panel. More than that: start another panel.
- Every bubble under about 100 characters. Split longer speeches at sentence ends into several lines by the same speaker, or across panels.
- Keep the source's dialogue wording. Change it only where a long speech has to be split; do not paraphrase, add or drop lines. Narration that matters becomes short Caption lines; description becomes picture prompts.
- Keep the source's order of events. Do not invent events or characters.
- All characters are adults (18 or older) and are written and described as adults.

# SETTINGS FOR THIS CONVERSION

- Character names: take them from the source; give unnamed speakers a short fixed label (Teacher, Guard).
- Language of dialogue, captions and titles: the language of the source; do not translate. Picture prompts are always in English.
- Panels per page: 4 to 6, never more than 6.

# OUTPUT

Reply with the script only, inside one code block (a line of three backticks before it and after it). No introduction, no explanation, no closing remarks. Inside the block use plain lines only: no markdown, no bold, no bullets, no numbering, no indentation. If the source is too long for one reply, convert as much as fits, stop at a page break, and continue from there when you are told "continue".

# EXAMPLE

Source:
It was almost midnight when Mika got home. Her brother Ken was waiting in the kitchen with his arms crossed. "Do you know what time it is?" he asked. She wanted to say she was sorry. "I lost track," she said. Then every light in the house went out with a bang.

Answer (the lines inside the code block):
[] Suburban house at night, exterior, one lit kitchen window, wide shot.
Caption: Almost midnight.
[Mika] Entrance hall, dim light, Mika taking off her shoes quietly, nervous, from behind.
[Ken, Mika] Kitchen at night, Ken standing with arms crossed, stern, Mika in the doorway, looking away, medium shot.
Ken: Do you know what time it is?
[Mika] Close-up of Mika, guilty expression, sweat drop.
Mika (thought): I'm sorry.
Mika: I lost track.
! [Ken, Mika] Dark kitchen, lights going out, Ken and Mika startled, silhouettes, dramatic lighting, from above.
SFX: BANG

# SOURCE

PASTE YOUR SCRIPT BELOW THIS LINE
````

## From an MCP client

`./mangamaker-mcp` is a stdio MCP server that serves the same pipeline to any MCP client: `script_format`, `check_script`,
`build_pages_from_script`, `list_poses`, `pose_shot`, `render_shot`, `place_renders`, `pod`, `cast`.
The repo's `.mcp.json` registers it for Claude Code; the `kks-mangamaker-script` skill
(`.claude/skills/`) writes scripts in this format.
