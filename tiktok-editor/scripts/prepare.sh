#!/usr/bin/env bash
# Step 1: download a Drive video, fix sync, transcribe.
# Usage: scripts/prepare.sh <slug> <google-drive-link-or-file-id>
# Output: work/<slug>/ {clip.mov, norm.mov, norm.wav, db.json, words.json, words.txt, frame.jpg}
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); SLUG=$1; LINK=$2
ID=$(echo "$LINK" | sed -E 's#.*/d/([^/?]+).*#\1#; s#.*[?&]id=([^&]+).*#\1#')
W=work/$SLUG; mkdir -p "$W"

echo "== Download ($ID)"
curl -sSL -o "$W/clip.mov" "https://drive.usercontent.google.com/download?id=$ID&export=download&confirm=t"
if file -b "$W/clip.mov" | grep -qi html; then
  echo "ERROR: Drive returned a web page, not the video. Ask the user to set the file to 'Anyone with the link'."; exit 2
fi
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,start_time -of compact "$W/clip.mov"
ffprobe -v error -select_streams a -show_entries packet=pts_time -of csv=p=0 "$W/clip.mov" \
  | awk -F, 'NR>1 && $1-p>0.03 {n++; g+=$1-p-0.0232} {p=$1} END{printf "audio gaps in source: %d (%.2fs) - handled by normalize\n", n, g}'

echo "== Normalize: constant 30fps + audio gaps/offset padded so audio matches the video timeline"
ffmpeg -v error -y -i "$W/clip.mov" -vf fps=30 -fps_mode cfr -af aresample=async=1:first_pts=0 \
  -c:v libx264 -preset fast -crf 14 -pix_fmt yuv420p -c:a pcm_s16le "$W/norm.mov"
ffmpeg -v error -y -i "$W/norm.mov" -ac 1 -ar 16000 "$W/norm.wav"
ffmpeg -v error -y -ss 3 -i "$W/norm.mov" -frames:v 1 -vf scale=360:-1 "$W/frame.jpg"

echo "== Loudness + transcription"
python3 -P scripts/energy.py "$W/norm.wav" "$W/db.json"
PYTHONPATH=$ROOT/.stub python3 -P scripts/transcribe.py models/vosk-model-small-en-us-0.15 "$W/norm.wav" "$W/words.json"
python3 -P -c "
import json, sys
w = json.load(open('$W/words.json'))
out = [f\"{i}:{x['word']}@{x['start']:.2f}\" + ('?' if x['conf'] < 0.6 else '') for i, x in enumerate(w)]
txt = '\n'.join('  '.join(out[i:i+10]) for i in range(0, len(out), 10))
open('$W/words.txt', 'w').write(txt + '\n'); print(txt)"
echo "Duration for cfg.json:"; ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/norm.mov"
