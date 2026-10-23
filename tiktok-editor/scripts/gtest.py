import sys, json, wave
from vosk import Model, KaldiRecognizer, SetLogLevel
SetLogLevel(-1)
m = Model(sys.argv[1]); wav = sys.argv[2]; opts = json.loads(sys.argv[3])
wf = wave.open(wav, "rb"); rec = KaldiRecognizer(m, 16000, json.dumps(opts + ["[unk]"])); rec.SetMaxAlternatives(4)
rec.AcceptWaveform(wf.readframes(wf.getnframes()))
for a in json.loads(rec.FinalResult())["alternatives"]: print(round(a["confidence"], 1), a["text"])
print('--')
