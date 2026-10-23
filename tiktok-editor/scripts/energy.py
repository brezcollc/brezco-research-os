import sys, wave, json, array, math
wf = wave.open(sys.argv[1]); sr = wf.getframerate()
x = array.array('h', wf.readframes(wf.getnframes()))
hop = sr // 100  # 10 ms
db = []
for i in range(0, len(x) - hop, hop):
    seg = x[i:i + hop]; rms = math.sqrt(sum(v * v for v in seg) / hop) + 1e-9
    db.append(20 * math.log10(rms / 32768))
json.dump(db, open(sys.argv[2], 'w'))
s = sorted(db); print('frames', len(db), 'p10', round(s[len(s)//10], 1), 'p50', round(s[len(s)//2], 1), 'p90', round(s[9*len(s)//10], 1))
