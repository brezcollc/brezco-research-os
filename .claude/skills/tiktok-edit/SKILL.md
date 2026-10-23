---
name: tiktok-edit
description: Edit a phone-recorded talking-head video for TikTok/Reels from a Google Drive link — sync fix, silence-based cuts, animated captions, graphics — and send back the MP4. Use when the user sends a Drive video link and asks to edit it "like the previous ones" / for TikTok.
---

# TikTok edit

The user sent a Google Drive video link (argument) to edit in their approved style.

1. Read `tiktok-editor/CLAUDE.md` in full and follow it exactly — it has the workflow, the approved style,
   and the lessons that prevent out-of-sync audio and clipped words.
2. Run `tiktok-editor/setup.sh` first (fresh cloud sessions don't have the tools).
3. Pick a short slug from the video's topic after transcribing (e.g. `meta-earnings`); you can rename the
   work folder before `cut.sh`, or just use a date slug.
4. Tell the user in one line that you've started and that their device can sleep. Keep later updates short.
5. Deliver with SendUserFile and a brief summary (length before/after, graphics, captions to double-check).

If no link was given, ask for the Drive link and remind them to set it to "Anyone with the link".
