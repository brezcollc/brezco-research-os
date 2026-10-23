# Cut plan from real audio silence (not recognizer timings). Usage: db.json words.json cfg.json out.json
import json, sys
db = json.load(open(sys.argv[1])); words = json.load(open(sys.argv[2])); cfg = json.load(open(sys.argv[3]))
dur = cfg["duration"]; FPS = 30
real = sorted(v for v in db if v > -200)
floor = real[len(real) // 10]
thr = floor + cfg.get("thr_db", 6)
MIN_PAUSE, KEEP_OUT, KEEP_IN = cfg.get("min_pause", 0.30), cfg.get("keep_out", 0.15), cfg.get("keep_in", 0.10)
silent = [v < thr for v in db]
runs, s = [], None
for i, q in enumerate(silent + [False]):
    if q and s is None: s = i
    if not q and s is not None:
        if (i - s) / 100 >= MIN_PAUSE: runs.append((s / 100, i / 100))
        s = None
# never cut through a recognized word (quiet words can dip under the threshold)
mids = [(w["start"] + w["end"]) / 2 for w in words]
runs = [(a, b) for a, b in runs if not any(a + 0.05 < m < b - 0.05 for m in mids)]
first = next(i for i, q in enumerate(silent) if not q) / 100
removed = []
for a, b in runs:
    if a <= first + 0.01:  # leading silence
        removed.append((0, max(0, b - KEEP_IN))); continue
    ca, cb = a + KEEP_OUT, b - KEEP_IN
    prev_end = max([w["end"] for w in words if w["end"] <= (a + b) / 2] or [0])
    next_start = min([w["start"] for w in words if w["start"] >= (a + b) / 2] or [dur])
    ca, cb = max(ca, prev_end + 0.12), min(cb, next_start - 0.08)
    if cb - ca >= 0.2: removed.append((ca, cb))
last_speech = max(i for i, q in enumerate(silent) if not q) / 100
end = min(dur - 0.02, last_speech + 0.5)
snap = lambda t: round(t * FPS) / FPS
segs, t = [], 0.0
for a, b in removed:
    a, b = snap(a), snap(b)
    if a > t: segs.append([t, a])
    t = max(t, b)
segs.append([t, snap(end)])
segs = [[round(a, 4), round(b, 4)] for a, b in segs if b - a > 0.05]
FIX = {int(k): v for k, v in cfg["fix"].items()}
def remap(x):
    off = 0
    for a, b in segs:
        if x < a: return off
        if x <= b: return off + x - a
        off += b - a
    return off
disp = []
for i, w in enumerate(words):
    txt = FIX.get(i, w["word"])
    s0, e0 = remap(w["start"]), remap(w["end"])
    if txt is None: disp[-1]["end"] = round(e0, 3); continue
    disp.append({"i": i, "text": txt, "start": round(s0, 3), "end": round(max(e0, s0 + 0.08), 3)})
total = sum(b - a for a, b in segs)
json.dump({"slug": cfg.get("slug", ""), "segments": segs, "words": disp, "duration": round(total, 4)}, open(sys.argv[4], "w"), indent=1)
print(f"threshold {thr:.1f} dB, {len(removed)} pauses tightened, {total:.2f}s from {dur}s (removed {dur - total:.2f}s)")
for a, b in removed: print(f"  cut {a:6.2f}-{b:6.2f} ({b - a:.2f}s)")
