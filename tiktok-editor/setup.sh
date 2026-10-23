#!/usr/bin/env bash
# One-time setup for a fresh cloud session (~1-2 min). Safe to re-run.
# Installs: Remotion (npm), Vosk speech recognizer (pip) + English model, Montserrat font.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(pwd)

echo "== Remotion (npm)"
(cd remotion && npm install --silent --no-fund --no-audit)

echo "== Montserrat font"
cp remotion/node_modules/@fontsource/montserrat/files/montserrat-latin-{800,900}-normal.woff2 remotion/public/

echo "== Vosk speech recognizer (pip)"
# 'srt' fails to build here and is only used for subtitle export, so install vosk without it and stub it.
pip install -q --no-deps vosk >/dev/null 2>&1 || pip install -q --no-deps --break-system-packages vosk
pip install -q cffi requests tqdm websockets >/dev/null 2>&1 || true
mkdir -p .stub && : > .stub/srt.py

echo "== Vosk English model"
# huggingface / alphacephei are blocked by the network policy; the npm package 'transcribe2texts' bundles the small English model.
if [ ! -d models/vosk-model-small-en-us-0.15 ]; then
  mkdir -p models/tmp && (cd models/tmp && npm pack transcribe2texts --silent >/dev/null 2>&1 && tar xzf transcribe2texts-*.tgz package/vosk-model-small-en-us-0.15)
  mv models/tmp/package/vosk-model-small-en-us-0.15 models/ && rm -rf models/tmp
fi

echo "== Checks"
command -v ffmpeg >/dev/null || { echo "ffmpeg missing"; exit 1; }
[ -x /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell ] || ls -d /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell
PYTHONPATH=$ROOT/.stub python3 -c "import vosk" && echo "vosk ok"
curl -sS -o /dev/null "https://drive.usercontent.google.com/" 2>/dev/null && echo "drive download: reachable" || echo "drive download BLOCKED: add drive.google.com + drive.usercontent.google.com to the environment's allowed domains"
echo "Setup done."
