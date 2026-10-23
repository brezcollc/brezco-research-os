#!/usr/bin/env bash
# Test what was actually said in an unclear spot (constrained recognition).
# Usage: scripts/check.sh <slug> <start_s> <end_s> '["option one","option two"]'
# Highest score wins. Words missing from the model vocabulary print a warning and are ignored
# (brand names like Lennar/hyperscalers often are) - then judge from context and flag it to the user.
set -euo pipefail
cd "$(dirname "$0")/.."
W=work/$1; T=$(mktemp -d)
ffmpeg -v error -y -ss "$2" -to "$3" -i "$W/norm.wav" "$T/c.wav"
PYTHONPATH=$(pwd)/.stub python3 -P scripts/gtest.py models/vosk-model-small-en-us-0.15 "$T/c.wav" "$4" 2>&1 | grep -v WARN || true
rm -rf "$T"
