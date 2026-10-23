#!/usr/bin/env bash
# Step 4: full render (~5 s of work per second of video - run it in the background) and compress
# under the 30 MB chat-upload limit. Output: out/<slug>-tiktok.mp4
# Usage: scripts/render.sh <slug>
set -euo pipefail
cd "$(dirname "$0")/.."
SLUG=$1; OUT=$(pwd)/out; mkdir -p "$OUT"
HS=$(ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell | head -1)
(cd remotion && npx remotion render "src/videos/$SLUG/main.jsx" Edit "$OUT/$SLUG-master.mp4" \
  --browser-executable="$HS" --concurrency=4 --crf=18 2>&1 | grep -iE "error|occurred|at src" | grep -v npm | head -10 || true)
[ -f "$OUT/$SLUG-master.mp4" ] || { echo "RENDER FAILED (see error above; 'frame N' tells you where)"; exit 1; }
for pair in 7M:14M 5.5M:11M 4.5M:9M 3.5M:7M; do
  rate=${pair%%:*}; buf=${pair##*:}
  ffmpeg -v error -y -i "$OUT/$SLUG-master.mp4" -c:v libx264 -preset slow -crf 23 -maxrate $rate -bufsize $buf \
    -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart "$OUT/$SLUG-tiktok.mp4"
  size=$(stat -c %s "$OUT/$SLUG-tiktok.mp4"); [ "$size" -lt 30000000 ] && break
done
ffprobe -v error -show_entries stream=codec_type,duration -of compact "$OUT/$SLUG-tiktok.mp4"
ls -la "$OUT/$SLUG-tiktok.mp4"
