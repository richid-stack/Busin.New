#!/usr/bin/env python3
"""
An original soundtrack, synthesized from scratch (no samples, nothing borrowed): 120 bpm in A minor, so every cut in the
edit lands on a beat. Writes a stereo WAV.   python3 music.py out.wav 50.5 "3.0,10.5,14.5,..."   (cut times in seconds)
"""
import sys, numpy as np
from scipy import signal
from scipy.io import wavfile
SR = 44100; BPM = 120; BEAT = 60 / BPM
out_path = sys.argv[1]; DUR = float(sys.argv[2]); CUTS = [float(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else []
rng = np.random.default_rng(7)
N = int(DUR * SR); L = np.zeros(N); R = np.zeros(N)
def add(buf, x, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N or i < 0: return
    x = x[:N - i]; l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(x)] += x * gain * l; R[i:i + len(x)] += x * gain * r
def t_(d): return np.arange(int(d * SR)) / SR
def env(d, a=0.005, r=None, curve=3.0):
    t = t_(d); r = r or d
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-curve * t / r)
    return e
def lp(x, f, order=2): return signal.sosfilt(signal.butter(order, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, order=2): return signal.sosfilt(signal.butter(order, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, order=2): return signal.sosfilt(signal.butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)

def kick(gain=1):
    t = t_(0.32); f = 48 + 90 * np.exp(-t * 30); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(1.6 * np.sin(ph)) * np.exp(-t * 11) * gain
def hat(open_=False):
    d = 0.22 if open_ else 0.05; return hp(rng.standard_normal(int(d * SR)), 7000) * env(d, .001, d, 6 if not open_ else 4) * .5
def clap():
    x = np.zeros(int(.3 * SR))
    for k, off in enumerate([0, .011, .024]):
        n = bp(rng.standard_normal(int(.12 * SR)), 1100, 3800) * env(.12, .001, .05, 4); i = int(off * SR); x[i:i + len(n)] += n
    return x * .7
def bass(freq, d):
    t = t_(d); x = np.sin(2 * np.pi * freq * t) + .35 * np.sin(2 * np.pi * freq * 2 * t); return np.tanh(1.4 * x) * env(d, .008, d * .8, 2.2)
def pluck(freq, d=.5):
    t = t_(d); x = sum((1 / h) * np.sin(2 * np.pi * freq * h * t + h) * np.exp(-t * (6 + 3 * h)) for h in range(1, 6)); return x * env(d, .002, d, 2) * .5
def pad(freqs, d):
    t = t_(d); x = np.zeros_like(t)
    for f in freqs:
        for det in (-.004, 0, .004):
            x += signal.sawtooth(2 * np.pi * f * (1 + det) * t) / 3
    x = lp(x, 1400 + 900 * np.sin(np.linspace(0, np.pi, len(t))), 2) if False else lp(x, 1500)
    return x * np.minimum(1, t / .6) * np.minimum(1, (d - t) / .8) * .12
def whoosh(d=.7, up=True):
    n = rng.standard_normal(int(d * SR)); t = np.linspace(0, 1, len(n))
    # sweep a bandpass by filtering in chunks
    out = np.zeros_like(n); c = 64; step = len(n) // c
    for k in range(c):
        a = k / c; fc = (300 + 5200 * (a ** 2)) if up else (5500 - 5000 * a)
        sos = signal.butter(2, [max(80, fc * .6), min(15000, fc * 1.5)], 'band', fs=SR, output='sos')
        out[k * step:(k + 1) * step] = signal.sosfilt(sos, n[k * step:(k + 1) * step])
    shape = (t ** 1.5) * (1 - t) ** .6 if up else (1 - t) ** 1.2
    return out * shape * 3.0
def reverb(x, secs=1.3, wet=.2):
    ir = rng.standard_normal(int(secs * SR)) * np.exp(-np.linspace(0, 6, int(secs * SR))); ir = lp(ir, 5000)
    return signal.fftconvolve(x, ir)[:len(x)] * wet / np.sqrt(np.sum(ir ** 2)) * 8

CH = [(110.0, [220.0, 261.63, 329.63]), (87.31, [174.61, 220.0, 261.63]), (130.81, [261.63, 329.63, 392.0]), (98.0, [196.0, 246.94, 293.66])]  # Am F C G
ARP = [0, 1, 2, 1, 2, 1, 2, 1]
def chord_at(t): return CH[int(t // (4 * BEAT)) % 4]
intro_end = CUTS[0] if CUTS else 3.0
groove_in = intro_end; hats_in = intro_end + 7.5 if CUTS else 10.5; lift_in = CUTS[-3] if len(CUTS) >= 3 else DUR - 12; outro_in = CUTS[-1] if CUTS else DUR - 5

pads = np.zeros(N); plucks_l = np.zeros(N); plucks_r = np.zeros(N)
# --- intro: thumps on each word, low rumble, riser
for k in range(3): add(None, kick(.9), k * 1.0)
for k in range(3): add(None, hat() * .6, k * 1.0 + .5)
add(None, whoosh(intro_end, True) * .35, 0)
# --- groove
bt = groove_in
while bt < outro_in - 1e-6:
    beat_i = int(round((bt - groove_in) / BEAT))
    add(None, kick(.85 if bt < hats_in else .95), bt)
    root, tones = chord_at(bt - groove_in)
    # eighth-note bass
    add(None, bass(root, BEAT * .48), bt, .42); add(None, bass(root * (2 if beat_i % 4 == 3 else 1), BEAT * .4), bt + BEAT / 2, .3)
    # arpeggio plucks (8ths), panned alternately, a dotted echo
    for h in range(2):
        tt = bt + h * BEAT / 2; idx = ARP[(beat_i * 2 + h) % 8]; f = tones[idx] * (2 if (beat_i * 2 + h) % 8 in (2, 4) else 1)
        p = pluck(f, .5); pan = -.5 if h == 0 else .5
        add(None, p, tt, .55, pan); add(None, p, tt + BEAT * .75, .22, -pan)
    if bt >= hats_in:
        add(None, hat(), bt + BEAT / 2, .5); 
        if beat_i % 2 == 1: add(None, clap(), bt, .6)
        if beat_i % 4 == 3: add(None, hat(True), bt + BEAT / 2, .45)
    bt += BEAT
# --- pads (whole groove + lift)
cur = groove_in
while cur < DUR - .1:
    root, tones = chord_at(cur - groove_in); d = min(4 * BEAT + .6, DUR - cur)
    add(None, pad(tones + [root * 2], d) * (1.5 if cur >= lift_in else 1.0), cur, 1.0); cur += 4 * BEAT
# --- transitions: a whoosh into and out of each cut, and a soft impact on the cut
for c in CUTS:
    add(None, whoosh(.42, True) * .55, c - .42); add(None, whoosh(.5, False) * .4, c)
    k_ = kick(1.0) * .7; k_[:int(.25 * SR)] += hp(rng.standard_normal(int(.25 * SR)), 2500) * env(.25, .001, .12, 5) * .25; add(None, k_, c, .9)
# --- end: last chord rings, then fades
t = outro_in
for f in (220.0, 261.63, 329.63, 440.0, 55.0): add(None, pluck(f, 2.2) * 1.2, t + .2, .5 if f > 100 else .9, 0)
# --- master: a touch of reverb, gentle limiter, fade out
mix = np.stack([L, R], 1)
for ch in range(2): mix[:, ch] += reverb(mix[:, ch], 1.2, .16)
fade = np.minimum(1, (DUR - np.arange(N) / SR) / 1.4); mix *= fade[:, None]
mix = np.tanh(mix * 1.1); mix = mix / (np.max(np.abs(mix)) + 1e-9) * .89
wavfile.write(out_path, SR, (mix * 32767).astype(np.int16)); print('music', out_path, DUR, 's')
