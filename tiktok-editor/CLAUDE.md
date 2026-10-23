# TikTok editor — instructions for Claude

The user (not technical, usually on their phone) records talking-head finance/tech videos on an iPhone,
uploads them to Google Drive, and sends a share link. You edit with this pipeline and send the MP4
back in chat (SendUserFile, ≤30 MB) so they can save it to their camera roll and post.

Keep replies short and plain-English. Never ask them to run commands.

## Workflow (run from `tiktok-editor/`)

0. **Setup once per session:** `./setup.sh` (installs Remotion, Vosk + model, fonts; checks Drive access).
1. **Prepare:** `scripts/prepare.sh <slug> <drive link>` → downloads, normalizes, transcribes, prints
   indexed words (`work/<slug>/words.txt`; `?` = low confidence). Read `work/<slug>/frame.jpg` to see framing.
   - "Drive returned a web page" → user must set the file to **Anyone with the link**.
   - curl 403 → environment network policy must allow `drive.google.com` and `drive.usercontent.google.com`
     (Custom network access + "include default list"). The user already set this up on their environment.
2. **Understand the transcript.** The small model garbles names/finance terms (e.g. "core we've"=CoreWeave,
   "in video"=Nvidia, "a i"=AI, "i p o"=IPO, "cap x"=capex, "in line are"=Lennar). Verify unclear spots:
   `scripts/check.sh <slug> <start> <end> '["option a","option b"]'`. Out-of-vocab words can't be verified —
   use context and **flag those captions to the user**.
3. **Write `work/<slug>/cfg.json`:** `{"duration": <seconds>, "fix": {"<word index>": "Display text" | null}}`.
   `null` merges that word into the previous caption word (e.g. "two point one billion" → "$2.1", null, null, "billion").
   Add punctuation so caption groups break at sentences. See `examples/*/cfg.json`.
4. **Cut:** `scripts/cut.sh <slug>` → silence-based plan, checks no cut touches a word, renders
   `remotion/public/cut-<slug>.mp4`, creates `remotion/src/videos/<slug>/Edit.jsx` from the template.
5. **Overlays:** edit only the bottom part of `remotion/src/videos/<slug>/Edit.jsx` (below "PER-VIDEO PART"),
   plus the `RED`/`YEL` caption-colour word sets, `PUNCH` (word indices for punch-in zooms) and the flash list
   near the top. Copy patterns from `examples/*/Edit.jsx`. `beat(a, b, pad)` spans word a→b.
   Watch out: if b is a word you set to null, `at(b)` resolves to the *next* word → overlaps. End beats on a real word.
6. **Preview:** `scripts/stills.sh <slug> <8 word indices>` → Read `work/<slug>/grid.png`. Check: one yellow
   highlighted word at a time, cards don't cover the eyes/face, no overlapping cards, captions spelled right.
7. **Render:** `scripts/render.sh <slug>` **in the background** (`run_in_background`, timeout 30 min; ~6 min
   for 75 s). Then SendUserFile `out/<slug>-tiktok.mp4`.
8. **Report** briefly: length before/after, pauses cut, list of graphics, and *only* the captions/claims they
   should double-check. Remind them you can't hear audio, so they should watch once with sound.

## The style the user approved ("perfect")
- Captions: Montserrat 900, uppercase, 1–3 words, the spoken word in a tilted yellow box; key words yellow,
  warning words red. Positioned over the chest (top: 1240).
- Top-of-screen graphics, one at a time, roughly every 3–6 s: `Card` (headline), `Chips` (items popping in as
  they're said), `Stat` (big number + label), `Counter` (count-up, integers only — use `Stat` for decimals),
  `Stamp` (DENIED/DEBT/BUY…, lands on the chest), `EmojiPop`, `YieldChart`/`DropChart`/`Pie`, `Note`.
- Punch-in zooms on key words, framing changes only at real cuts, a few white flashes on big moments,
  progress bar, closing "👇 question?" card in the last 36 frames to drive comments (use the `TOTAL` pattern
  from the template — a fixed offset from the last word can land after the video ends).
- More visuals/pop is welcome, but never cover the face or stack cards.

## Hard-won lessons (don't regress)
- **Sync:** iPhone files can have audio that starts late and *gaps in the audio track* (0.15–0.2 s each).
  Always work from `norm.mov` (constant 30 fps + `aresample=async=1:first_pts=0`) and transcribe *that* audio.
  Transcribing the raw file made captions/cuts drift ~1 s by the end and clipped words.
- **Cuts:** only inside real silence (loudness envelope), ≥0.12 s after a word / ≥0.08 s before the next,
  snapped to frames; skip cuts <0.2 s. Never cut by recognizer word times alone. Don't add fake "cuts"
  (framing jumps) mid-sentence. Stumble removal: only if there's a real pause around it, otherwise leave it.
- **Charts with made-up shapes** must say "illustrative"; only use numbers the user actually said.
- **Sensitive topics** (suicide, self-harm): no flashes/stamps/emoji/zooms in that section, calm card,
  small "If you're struggling: call or text 988 (US)" `Note`, and offer TikTok-safe caption wording.
- Don't put insults about named people in big on-screen text; captions follow what was said, and flag them.
- `remotion still`/`render` need `--browser-executable` = chromium **headless_shell** (not `/opt/pw-browsers/chromium`).
- Outputs >30 MB can't be sent in chat; `render.sh` compresses automatically.

## Layout
- `setup.sh` — installer. `scripts/` — pipeline. `remotion/src/template/` — the current template.
- `remotion/src/videos/<slug>/` — per-video edit (created by cut.sh). `examples/` — past videos' overlays + caption fixes.
- `work/`, `out/`, `models/`, `node_modules/` are git-ignored (videos are never committed).
