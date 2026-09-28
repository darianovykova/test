"""Synthesise the UI sound layer from the cue sheet exported by motion.js.

Every sound is generated procedurally (no samples, no licensing). Events are
placed on a circular buffer of exactly one loop length, so reverb tails wrap
around and the audio loops as seamlessly as the picture.

    python3 synth.py out/sound_events.json out/ui_sounds.wav
"""
import json, sys, wave
import numpy as np

SR = 48000
rng = np.random.default_rng(7)


def env(n, attack, decay):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-t / decay)


def tone(freq0, freq1, dur, attack, decay, harm=0.0):
    n = int(dur * SR)
    f = np.geomspace(freq0, freq1, n)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) + harm * np.sin(2 * ph)
    return s * env(n, attack, decay)


def noise(dur, decay, hp=0.0):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    if hp:  # one-pole high-pass
        a = np.exp(-2 * np.pi * hp / SR)
        y = np.empty_like(x); prev_x = prev_y = 0.0
        for i, v in enumerate(x):
            prev_y = a * (prev_y + v - prev_x); prev_x = v; y[i] = prev_y
        x = y
    return x * env(n, 0.0005, decay)


def mixin(*parts):
    n = max(len(p) for _, p in parts)
    out = np.zeros(n)
    for off, p in parts:
        o = int(off * SR); out[o:o + len(p)] += p[: n - o]
    return out


def make(kind, pitch=1.0):
    p = pitch
    if kind == 'click':      # crisp trackpad click: transient + short body
        return mixin((0, 0.35 * noise(0.012, 0.0022, hp=2500)),
                     (0, 0.55 * tone(2400 * p, 1900 * p, 0.03, 0.0004, 0.006)),
                     (0, 0.45 * tone(210, 150, 0.05, 0.001, 0.012)))
    if kind == 'hover':      # barely-there tick
        return 0.22 * tone(3600 * p, 3300 * p, 0.012, 0.0005, 0.0025)
    if kind == 'tick':
        return 0.3 * tone(1800 * p, 1500 * p, 0.03, 0.0008, 0.006)
    if kind == 'scrub':
        return 0.22 * tone(2300 * p, 2100 * p, 0.02, 0.0005, 0.004)
    if kind == 'pop':        # soft bubble for entrances
        return 0.42 * tone(420 * p, 690 * p, 0.12, 0.004, 0.032, harm=0.15)
    if kind == 'rise':       # data drawing in
        return 0.16 * tone(380 * p, 980 * p, 0.55, 0.06, 0.16, harm=0.2)
    if kind == 'open':
        return mixin((0.0, 0.26 * tone(620, 660, 0.12, 0.003, 0.035)),
                     (0.045, 0.22 * tone(930, 990, 0.14, 0.003, 0.04)),
                     (0, 0.05 * noise(0.08, 0.02, hp=4000)))
    if kind == 'close':
        return mixin((0.0, 0.2 * tone(930, 880, 0.1, 0.003, 0.028)),
                     (0.04, 0.18 * tone(640, 600, 0.12, 0.003, 0.03)))
    if kind == 'tab':
        return mixin((0, 0.3 * tone(1250, 1180, 0.06, 0.001, 0.012)),
                     (0.028, 0.22 * tone(1870, 1800, 0.07, 0.001, 0.014)))
    if kind == 'refresh':    # airy arpeggio when data updates
        return mixin(*[(i * 0.038, 0.13 * tone(f, f * 1.003, 0.45, 0.004, 0.11)) for i, f in enumerate((880, 1108.7, 1318.5, 1760))])
    if kind == 'out':        # content resolving away
        return 0.14 * tone(760 * p, 380 * p, 0.5, 0.02, 0.14, harm=0.1)
    raise ValueError(kind)


def reverb_ir(dur=0.35):
    n = int(dur * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR / 0.07)
    ir[:int(0.012 * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2))


def main(cues, out):
    data = json.load(open(cues))
    T = data['T']; N = int(round(T * SR))
    dry = np.zeros((2, N))
    for ev in data['events']:
        s = make(ev['type'], ev.get('pitch', 1.0)) * ev.get('gain', 1.0)
        start = int(round(ev['t'] * SR))
        idx = (start + np.arange(len(s))) % N            # circular placement
        pan = 0.08 * np.sin(ev['t'] * 1.7)                # tiny stereo movement
        np.add.at(dry[0], idx, s * (1 - pan)); np.add.at(dry[1], idx, s * (1 + pan))
    ir = reverb_ir()
    wet = np.stack([np.real(np.fft.ifft(np.fft.fft(ch) * np.fft.fft(ir, N))) for ch in dry])  # circular conv.
    mix = dry + 0.18 * wet
    mix *= 10 ** (-6 / 20) / np.max(np.abs(mix))           # peak −6 dBFS
    pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
    with wave.open(out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    print(f'wrote {out}: {T}s, {len(data["events"])} cues')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
