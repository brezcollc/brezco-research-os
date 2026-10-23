#!/usr/bin/env bash
# Step 3: preview frames before the full render. Pass caption word indices (original indices from words.txt);
# renders the frame ~0.6s after each word starts and stacks them into work/<slug>/grid.png (view it with Read).
# Usage: scripts/stills.sh <slug> <word_index> [<word_index> ...]   (up to 8)
set -euo pipefail
cd "$(dirname "$0")/.."
SLUG=$1; shift; W=$(pwd)/work/$SLUG; V=src/videos/$SLUG
HS=$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell | head -1)
FRAMES=$(python3 -P - "remotion/$V/plan.json" "$@" <<'EOF'
import json, sys
p = json.load(open(sys.argv[1])); W = {w["i"]: w for w in p["words"]}
def at(i):
    for k in range(i, i + 10):
        if k in W: return W[k]
print(" ".join(str(int((at(int(i))["start"] + 0.6) * 30)) for i in sys.argv[2:]))
EOF
)
cd remotion; rm -f "$W"/still-*.png; inputs=""
for fr in $FRAMES; do
  npx remotion still "$V/main.jsx" Edit "$W/still-$fr.png" --frame=$fr --scale=0.4 --browser-executable="$HS" --log=error 2>&1 | grep -v "npm notice" | head -5 || true
  inputs="$inputs -i $W/still-$fr.png"
done
n=$(echo $FRAMES | wc -w)
if [ "$n" -ge 8 ]; then F="[0][1][2][3]hstack=4[a];[4][5][6][7]hstack=4[b];[a][b]vstack"; else F="hstack=$n"; fi
ffmpeg -v error -y $inputs -filter_complex "$F" "$W/grid.png" && echo "preview: $W/grid.png"
