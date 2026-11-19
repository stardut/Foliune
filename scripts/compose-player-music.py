"""Reproducible original Foliune music. No samples or third-party music.
Requires Python 3 and NumPy; generated WAVs are checked in, no runtime dependency.
"""
from pathlib import Path
import wave
import numpy as np

RATE = 22050
OUT = Path(__file__).resolve().parents[1] / 'apps/desktop/public/music'
RNG = np.random.default_rng(20261119)


def compose(name, bpm, bright):
    beat = 60 / bpm
    size = round(32 * beat * RATE)
    mix = np.zeros((size, 2), np.float64)

    def add(at, sound, gain=1, pan=0):
        index = (np.arange(len(sound)) + round(at * RATE)) % size
        mix[index, 0] += sound * gain * np.sqrt((1-pan)/2)
        mix[index, 1] += sound * gain * np.sqrt((1+pan)/2)

    def tone(midi, duration, kind='keys'):
        t = np.arange(round(duration * RATE)) / RATE
        f = 440 * 2 ** ((midi-69)/12)
        if kind == 'pad':
            s = (np.sin(2*np.pi*f*t) + .25*np.sin(2*np.pi*(f*1.002)*t) + .12*np.sin(4*np.pi*f*t))
            env = np.minimum(t/.32, 1) * np.minimum((duration-t)/.65, 1) * .12
        elif kind == 'bass':
            s = np.sin(2*np.pi*f*t) + .16*np.sin(4*np.pi*f*t)
            env = np.minimum(t/.018,1) * np.minimum((duration-t)/.12,1) * np.exp(-t*.9) * .33
        else:
            # Electric-piano-like FM partials with soft attack and bell decay.
            s = np.sin(2*np.pi*f*t + .65*np.sin(2*np.pi*f*2*t)*np.exp(-t*3))
            s += .18*np.sin(2*np.pi*f*3*t)*np.exp(-t*5)
            env = (1-np.exp(-t*160))*np.exp(-t*2.3) * np.minimum((duration-t)/.08,1) * .23
        return s * np.maximum(env,0)

    chords = [[50,57,60,64], [46,53,57,60], [53,60,64,67], [48,55,58,62]]
    if bright:
        chords = [[48,55,59,62], [52,59,62,67], [45,52,55,59], [53,60,64,67]]
    melody = [76,72,69,67, 69,72,74,72] if not bright else [79,74,76,71, 72,76,79,74]
    for bar in range(8):
        chord = chords[bar % 4]
        start = bar * 4 * beat
        for n, note in enumerate(chord):
            add(start, tone(note+12, beat*4+.65, 'pad'), .4, (n-1.5)*.35)
            add(start + (n*.5 if bright else n*.055)*beat, tone(note+12, beat*2.2), .6, (n-1.5)*.22)
        add(start, tone(chord[0]-12, beat*1.7, 'bass'), .72)
        add(start+2*beat, tone(chord[0]-12, beat*1.5, 'bass'), .48)
        add(start+beat*(1.5 if bright else 2.5), tone(melody[bar], beat*1.9), .65, .28)
        if bright:
            add(start+3.5*beat, tone(melody[bar]-5, beat), .32, -.3)
        for b in range(4):
            # Rounded low kick on each beat, more weight on the bar downbeat.
            t = np.arange(round(.25*RATE))/RATE
            kick = np.sin(2*np.pi*(48*t + 32*.025*(1-np.exp(-t/.025)))) * np.exp(-t*20) * (1-np.exp(-t*900))
            add(start+b*beat, kick, (.26 if b==0 else .13) if bright else (.23 if b==0 else .09))
            if b in (1,3):
                t = np.arange(round(.17*RATE))/RATE
                noise = RNG.normal(0,1,len(t))
                brush = np.convolve(noise, np.ones(4)/4, mode='same') * np.exp(-t*28) * (1-np.exp(-t*500))
                add(start+b*beat, brush, .12 if bright else .07, -.16)
            for half in range(2):
                t = np.arange(round(.055*RATE))/RATE
                noise = RNG.normal(0,1,len(t))
                hat = np.concatenate(([0],np.diff(noise))) * np.exp(-t*100) * (1-np.exp(-t*1500))
                add(start+(b+half*.5)*beat, hat, .018 if half else .025, .35)
    # Circular cross-channel echoes preserve exact bar count and natural loop tails.
    dry = mix.copy()
    for delay, gain in [(beat*.75,.12),(beat*1.5,.07),(.043,.08),(.071,.06)]:
        mix += np.roll(dry[:, ::-1], round(delay*RATE), axis=0)*gain
    peak = np.max(np.abs(mix))
    mix = np.tanh(mix/peak*1.15) * .78
    with wave.open(str(OUT / f'{name}.wav'),'wb') as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes((mix*32767).astype('<i2').tobytes())
    rms = np.sqrt(np.mean(mix**2))
    print(f'{name}: {size/RATE:.6f}s, {bpm} BPM, peak {np.max(np.abs(mix)):.3f}, RMS {rms:.3f}')

OUT.mkdir(parents=True, exist_ok=True)
compose('mist-walk',72,False)
compose('light-pulse',108,True)
