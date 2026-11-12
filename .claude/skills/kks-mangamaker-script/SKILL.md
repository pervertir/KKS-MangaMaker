---
name: kks-mangamaker-script
description: Write manga scripts for the KKS-MangaMaker Script Wizard (the plain-text format that becomes pages, panels, lettered bubbles and one render shot per panel), from a story idea, outline, chapter summary or existing text, and optionally build, pose and render them through the kks-mangamaker MCP server. Use whenever the user asks for a manga/comic script, chapter, page, scene, 4-koma or storyboard for MangaMaker, or to turn a story into pages.
---

# Writing scripts for the KKS-MangaMaker Script Wizard

The Script Wizard reads a scene as plain lines and builds the pages itself: layout per page, panels,
bubbles in reading order with tails toward the speaker, and one shot per panel whose characters and
prompt drive the AI render. Your job is to write that script well. The full reference is
`docs/SCRIPT_WIZARD.md` (or the MCP tool `script_format`).

## The format (one thing per line)

```text
Title: CHAPTER TITLE                     big title on the page (covers, openers)
[Name, Name] picture prompt              a new panel: who is in it LEFT TO RIGHT, then what the render shows
! [Name] picture prompt                  "!" = big panel (the page's key moment)
Name: spoken line                        speech
Name (thought): line                     thought      Name (shout): line   shout      Name (whisper): line   whisper
Caption: The next morning.               caption box (time, place, narration)
SFX: BAM                                 sound effect
---                                      new page
# 4-koma                                 this page is a four-panel strip; any other "# ..." line is a note
```

Dialogue belongs to the panel above it. Names must be spelled the same every time.

## How to write it

1. **Get the cast straight first.** List every character with a consistent name (and series if it is
   a known character, which helps the LoRA search). Ask only if the user's request leaves the cast
   genuinely unclear; otherwise choose and state your choice.
2. **Break the story into pages, then beats.** 4–6 panels per page (the wizard splits after 6). Each
   panel is ONE moment. A page builds to one key moment: mark it with `!`. End pages on a hook.
3. **Write each panel's prompt as a picture, not as story**: place, time of day, what each person is
   doing, expression, camera. Prefer short Danbooru-style phrases the model knows: `school rooftop,
   noon, sitting, eating bento, smiling, looking at each other, wide shot`. No dialogue or inner
   thoughts in the prompt; no names in the prompt beyond who is in `[...]`.
4. **Order `[...]` left to right as they stand.** Tails, regional prompts and per-character identity
   follow that order. Keep to at most 3 characters per panel.
5. **Letter sparingly.** 0–3 lines per panel, each under ~100 characters; split long speeches. Use
   thought/shout/whisper only when it changes the bubble. Captions for time and place, SFX short and
   punchy (BAM, DOKI DOKI, ZAAA, ゴゴゴ).
6. **Vary the camera across a page**: establishing wide shot, medium shots for talk, a close-up for a
   reaction, a dynamic angle for action. Say it in the prompt (`close-up`, `from below`, `wide shot`).
7. **4-koma**: put `# 4-koma` on the page and write exactly four panels: setup, development, twist,
   punchline.

## Checklist before handing it over

- Every panel line starts with `[...]` (or is a deliberate empty/background panel) and has a prompt.
- Every speaker appears in their panel's `[...]`, spelled identically.
- No panel has more than 3 lines of dialogue or more than 3 characters.
- Each page has one `!` panel at most, and pages are separated by `---`.
- All characters are adults.

## Building it (when the kks-mangamaker MCP server is available)

1. `check_script` with the script; fix every warning it reports.
2. `cast` to record characters once (name, series, lora, tags, gender) so every shot is consistent.
3. `build_pages_from_script` (project name, `shot_prefix` like `ch1`, `reading: rtl` for manga).
4. For each shot: `list_poses` (by `type`: Standing, Sitting, Walking & running, Fighting, Kneeling,
   Lying, ..., Group poses and the Adult · types for two- and three-person positions), then
   `pose_shot` with figures left to right (a group pose id brings all its figures) and a `framing`
   (full, knees, waist, chest, close) that matches the panel's camera words.
5. `render_shot` only when the user wants renders (it uses the paid GPU pod; `pod` status/start/stop),
   then `place_renders`, and tell the user to open the project in the editor to adjust and export.

Without the MCP server, hand the user the script in a code block and tell them to paste it into the
**✎ Script Wizard** in the editor.
