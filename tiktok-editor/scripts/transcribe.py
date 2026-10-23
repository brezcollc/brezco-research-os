import sys, json, wave
from vosk import Model, KaldiRecognizer, SetLogLevel
SetLogLevel(-1)
model_dir, wav_path, out_path = sys.argv[1:4]
wf = wave.open(wav_path, "rb")
rec = KaldiRecognizer(Model(model_dir), wf.getframerate())
rec.SetWords(True)
words = []
while True:
    data = wf.readframes(4000)
    if not data: break
    if rec.AcceptWaveform(data):
        words += json.loads(rec.Result()).get("result", [])
words += json.loads(rec.FinalResult()).get("result", [])
json.dump(words, open(out_path, "w"), indent=0)
print(len(words), "words")
