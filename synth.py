"""Synthesise the interface sound layer from the cue sheet exported by motion.js.

Only realistic interface sounds: the mouse button being pressed ('down') and
released ('up'), and scroll-wheel detents ('wheel'). Each click is modelled physically — a very short excitation
burst ringing through a few resonances of a plastic mouse shell, plus a tiny
low-frequency body knock — rather than a musical blip. Everything is procedural
(no samples, no licensing). Events are placed on a circular buffer of exactly
one loop length, so the small-room tail wraps and the audio loops seamlessly.

    python3 synth.py out/sound_events.json out/ui_sounds.wav
"""
import json, sys, wave
import numpy as np

SR = 48000


def biquad_bandpass(x, f0, q):
    w0 = 2 * np.pi * f0 / SR
    alpha = np.sin(w0) / (2 * q)
    b0, b1, b2 = alpha, 0.0, -alpha
    a0, a1, a2 = 1 + alpha, -2 * np.cos(w0), 1 - alpha
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    y = np.zeros_like(x); x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def wheel(seed):
    """One detent of a mouse scroll wheel: a tiny, dry, high tick."""
    rng = np.random.default_rng(seed)
    n = int(0.02 * SR); t = np.arange(n) / SR
    exc = np.zeros(n); b = int(0.0004 * SR)
    exc[:b] = rng.standard_normal(b) * np.hanning(b * 2)[b:]
    j = 1 + rng.uniform(-0.05, 0.05)
    s = sum(g * biquad_bandpass(exc, f * j, q) for f, q, g in [(3300, 10, 1.0), (5400, 12, 0.6), (8200, 9, 0.3)])
    s *= np.exp(-t / 0.0022)
    return s / np.max(np.abs(s))


def click(kind, seed):
    """Mouse switch click. 'down' is brighter and louder than the release."""
    rng = np.random.default_rng(seed)
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    # excitation: sub-millisecond burst (the switch snapping) + a faint second bounce
    exc = np.zeros(n)
    burst = int(0.0007 * SR)
    exc[:burst] = rng.standard_normal(burst) * np.hanning(burst * 2)[burst:]
    bounce = int((0.0019 if kind == 'down' else 0.0014) * SR)
    exc[bounce:bounce + burst] += 0.35 * rng.standard_normal(burst) * np.hanning(burst * 2)[burst:]
    # shell resonances (slightly detuned per click so no two are identical)
    j = 1 + rng.uniform(-0.04, 0.04)
    modes = ([(2150, 9, 1.0), (3900, 12, 0.7), (6400, 14, 0.45), (9800, 10, 0.25)] if kind == 'down'
             else [(1900, 8, 0.8), (3500, 10, 0.55), (5600, 12, 0.3)])
    s = sum(g * biquad_bandpass(exc, f * j, q) for f, q, g in modes)
    # low body knock of the button hitting the switch
    body = np.sin(2 * np.pi * (140 if kind == 'down' else 170) * j * t) * np.exp(-t / 0.004)
    s = s + (0.05 if kind == 'down' else 0.025) * body
    s *= np.exp(-t / (0.006 if kind == 'down' else 0.0045))
    return s / np.max(np.abs(s))


def room_ir(dur=0.12):
    rng = np.random.default_rng(3)
    n = int(dur * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR / 0.018)
    ir[: int(0.004 * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2))


def main(cues, out):
    data = json.load(open(cues))
    T = data['T']; N = int(round(T * SR))
    dry = np.zeros((2, N))
    for ev in data['events']:
        s = (wheel(ev.get('seed', 0)) if ev['type'] == 'wheel' else click(ev['type'], ev.get('seed', 0))) * ev.get('gain', 1.0)
        start = int(round(ev['t'] * SR))
        idx = (start + np.arange(len(s))) % N                 # circular placement
        pan = 0.06                                             # mouse sits slightly right of centre
        np.add.at(dry[0], idx, s * (1 - pan)); np.add.at(dry[1], idx, s * (1 + pan))
    ir = room_ir()
    wet = np.stack([np.real(np.fft.ifft(np.fft.fft(ch) * np.fft.fft(ir, N))) for ch in dry])  # circular conv.
    mix = dry + 0.06 * wet
    mix *= 10 ** (-9 / 20) / np.max(np.abs(mix))               # peak −9 dBFS: a click, not an effect
    pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
    with wave.open(out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print(f'wrote {out}: {T}s, {len(data["events"])} cues')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
