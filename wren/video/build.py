#!/usr/bin/env python3
"""Builds the Wren demo video.

Steps:
  1. Narrate every line with Kokoro TTS (a local model, so no API key is needed).
  2. Lay the lines out on a timeline and write captions (WebVTT).
  3. Synthesize a quiet music bed, then mix it with the voice and duck it under speech.
  4. Render scenes.html frame by frame in headless Chromium, then encode it to H.264 MP4 with a poster frame.

Requirements: pip install kokoro-onnx soundfile numpy imageio-ffmpeg. You also need the Kokoro model files
(kokoro-v1.0.int8.onnx and voices-v1.0.bin) in $KOKORO_DIR, and Playwright with Chromium.
Output goes to ../public/media/.
"""
import json, os, subprocess, sys, wave, math
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public" / "media"
WORK = Path(os.environ.get("WREN_VIDEO_WORK", "/tmp/wren-video"))
KOKORO = Path(os.environ.get("KOKORO_DIR", "/tmp/voices"))
SR = 48000
FPS = int(os.environ.get("FPS", 30))
WORK.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)

def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def resample(x, sr_in, sr_out):
    n = int(len(x) * sr_out / sr_in)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)

# ---------- 1. narration ----------
spec = json.loads((HERE / "narration.json").read_text())
from kokoro_onnx import Kokoro
tts = Kokoro(str(KOKORO / "kokoro-v1.0.int8.onnx"), str(KOKORO / "voices-v1.0.bin"))
clips = []
for si, sc in enumerate(spec["scenes"]):
    for li, line in enumerate(sc["lines"]):
        cache = WORK / f"{si:02d}-{li}.npy"
        key = WORK / f"{si:02d}-{li}.txt"
        if cache.exists() and key.exists() and key.read_text() == line:
            a = np.load(cache)
        else:
            s, sr = tts.create(line, voice=spec["voice"], speed=spec["speed"], lang="en-us")
            a = resample(np.asarray(s, dtype=np.float32), sr, SR)
            # trim silence
            idx = np.where(np.abs(a) > 0.01)[0]
            a = a[max(0, idx[0] - 800): idx[-1] + 1600] if len(idx) else a
            np.save(cache, a); key.write_text(line)
        clips.append((si, li, a))
        print(f"voice {si}.{li}: {len(a)/SR:.2f}s  {line}")

# ---------- 2. timeline ----------
GAP_LINE = 0.35
LEAD = 0.5
t = 0.0
scenes, cues_vtt = [], []
for si, sc in enumerate(spec["scenes"]):
    start = t
    t += LEAD if si else 0.9
    cues = []
    for (csi, li, a) in [c for c in clips if c[0] == si]:
        cues.append(round(t, 3))
        cues_vtt.append((t, t + len(a) / SR, sc["lines"][li], a))
        t += len(a) / SR + GAP_LINE
    t += sc.get("pad", 0.5)
    scenes.append({"id": sc["id"], "chapter": sc["chapter"], "start": round(start, 3), "end": round(t, 3), "cues": cues})
total = round(t, 3)
tl = {"scenes": scenes, "total": total}
(WORK / "timeline.json").write_text(json.dumps(tl, indent=1))
print(f"total {total:.1f}s")

def ts(x):
    h = int(x // 3600); m = int(x % 3600 // 60); s = x % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"
vtt = ["WEBVTT", ""]
for i, (a, b, text, _) in enumerate(cues_vtt, 1):
    vtt += [str(i), f"{ts(a)} --> {ts(b + 0.2)}", text, ""]
(OUT / "wren-demo.vtt").write_text("\n".join(vtt))
(OUT / "wren-demo-chapters.json").write_text(json.dumps([{"t": s["start"], "title": s["chapter"]} for s in scenes], indent=1))

# ---------- 3. audio ----------
N = int(total * SR) + SR
voice = np.zeros(N, np.float32)
for (a, b, _, clip) in cues_vtt:
    i = int(a * SR); voice[i:i + len(clip)] += clip
voice *= 0.92 / max(1e-6, np.abs(voice).max())

tt = np.arange(N) / SR
def note(f): return 440.0 * 2 ** ((f - 69) / 12)
music = np.zeros(N, np.float32)
# Warm pad on a four-bar progression: C, G/B, Am, F. Each chord lasts 4 s.
prog = [[48, 55, 60, 64], [47, 55, 59, 62], [45, 52, 57, 60], [41, 53, 57, 60]]
bar = 4.0
for k in range(int(total / bar) + 2):
    ch = prog[k % 4]; a0 = int(k * bar * SR); a1 = min(N, int((k + 1) * bar * SR + SR))
    seg = tt[a0:a1] - k * bar
    env = np.clip(seg / 1.2, 0, 1) * np.clip((bar + 1 - seg) / 1.2, 0, 1)
    for m in ch:
        f = note(m)
        music[a0:a1] += (0.5 * np.sin(2 * np.pi * f * seg) + 0.18 * np.sin(2 * np.pi * 2 * f * seg + 0.3)) * env * 0.06
# Soft plucked melody on a pentatonic scale, every half beat, sparse and deterministic
rng = np.random.default_rng(4)
penta = [72, 74, 76, 79, 81, 84]
step = 0.5
for k in range(int(total / step)):
    if rng.random() < 0.45: continue
    m = penta[(k * 3 + int(rng.integers(0, 3))) % len(penta)]
    a0 = int(k * step * SR); L = int(1.6 * SR); a1 = min(N, a0 + L)
    seg = tt[a0:a1] - k * step
    music[a0:a1] += np.sin(2 * np.pi * note(m) * seg) * np.exp(-seg * 3.2) * 0.05
# Duck the music under the voice.
env = np.abs(voice)
win = int(0.25 * SR)
env = np.convolve(env, np.ones(win) / win, mode="same")
duck = 1.0 - 0.6 * np.clip(env / 0.04, 0, 1)
fade = np.clip(tt / 1.5, 0, 1) * np.clip((total - tt) / 2.5, 0, 1)
mix = voice + music * duck * fade * 0.9
mix = np.tanh(mix * 1.1) * 0.95
pcm = (np.clip(mix, -1, 1) * 32767).astype(np.int16)
with wave.open(str(WORK / "mix.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

# ---------- 4. render ----------
r = subprocess.run(["node", str(HERE / "render.cjs"), str(WORK / "timeline.json"), str(WORK / "video.mp4"), str(FPS), str(OUT / "wren-demo-poster.jpg")], check=True)
subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-i", str(WORK / "video.mp4"), "-i", str(WORK / "mix.wav"),
                "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(OUT / "wren-demo.mp4")], check=True)
print("wrote", OUT / "wren-demo.mp4", f"{(OUT / 'wren-demo.mp4').stat().st_size/1e6:.1f} MB")
