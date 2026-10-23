#!/usr/bin/env bash
# Step 2: plan cuts from real silence, verify no cut touches a word, render the cut base video,
# and set up remotion/src/videos/<slug>/ from the template (if not there yet).
# Usage: scripts/cut.sh <slug>      (needs work/<slug>/cfg.json - see CLAUDE.md)
set -euo pipefail
cd "$(dirname "$0")/.."
SLUG=$1; W=work/$SLUG; V=remotion/src/videos/$SLUG
python3 -P - "$W/cfg.json" "$SLUG" <<'EOF'
import json, sys
p, slug = sys.argv[1], sys.argv[2]; c = json.load(open(p)); c["slug"] = slug; json.dump(c, open(p, "w"))
EOF
python3 -P scripts/silence_plan.py "$W/db.json" "$W/words.json" "$W/cfg.json" "$W/plan.json"
python3 -P - "$W/plan.json" "$W/words.json" <<'EOF'
import json, sys
p = json.load(open(sys.argv[1])); w = json.load(open(sys.argv[2]))
edges = [a for a, b in p["segments"][1:]] + [b for a, b in p["segments"][:-1]]
bad = [(round(t, 2), x["word"]) for t in edges for x in w if x["start"] - 0.06 < t < x["end"] + 0.06]
print("boundaries touching a word:", bad or "none")
print("\nCAPTIONS:\n" + " ".join(x["text"] for x in p["words"]))
if bad: sys.exit("ERROR: a cut touches a word - adjust cfg (thr_db/min_pause) before rendering")
EOF
python3 -P scripts/cut.py "$W/norm.mov" "$W/plan.json" "remotion/public/cut-$SLUG.mp4"
mkdir -p "$V"; cp "$W/plan.json" "$V/plan.json"
[ -f "$V/Edit.jsx" ] || { cp remotion/src/template/Edit.jsx remotion/src/template/main.jsx "$V/"; echo "created $V/Edit.jsx from template - now write this video's overlays"; }
ffprobe -v error -show_entries stream=codec_type,duration -of compact "remotion/public/cut-$SLUG.mp4"
