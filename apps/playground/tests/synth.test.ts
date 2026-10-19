import { describe, expect, it, vi } from 'vitest';
import { synthesize } from '../src/audio/synth.ts';
import { buildTimeline } from '../src/core/timeline.ts';
import type { SoundEvent, SoundSpec, Timeline } from '../src/core/types.ts';
import { LETTER_SOUNDS, VOWELS } from '../src/styles/alphabet.ts';
import { STYLE_LIST } from '../src/styles/index.ts';

const SR = 44100;
const VOICE = { pitch: 0, speed: 15, variation: 0.3 };

function single(sound: Partial<SoundSpec>, duration = 0.2): Timeline {
  const event: SoundEvent = {
    tokenIndex: 0,
    start: 0,
    duration,
    sound: { waveform: 'sine', frequency: 440, durationRatio: 0.5, gain: 0.5, ...sound },
    dot: { color: 'red', size: 'md' },
  };
  return { tokens: [], events: [event], duration: duration + 0.05 };
}

const slice = (data: Float32Array, from: number, to: number) => data.subarray(Math.round(from * SR), Math.round(to * SR));
const rms = (data: Float32Array) => Math.sqrt(data.reduce((a, x) => a + x * x, 0) / data.length);
const crossings = (data: Float32Array) => data.reduce((n, x, i) => (i > 0 && Math.sign(x) !== Math.sign(data[i - 1]) ? n + 1 : n), 0);

describe('synthesize', () => {
  it('returns ceil(duration × sampleRate) samples (R7.4)', () => {
    const t = buildTimeline('Hello', STYLE_LIST[0], VOICE);
    expect(synthesize(t)).toHaveLength(Math.ceil(t.duration * SR));
    expect(synthesize({ tokens: [], events: [], duration: 0 })).toHaveLength(0);
  });

  it.each(STYLE_LIST.map((s) => [s.id, s] as const))('%s is deterministic (R3.8, R7.2)', (_, style) => {
    const t = buildTimeline('Hello, world!', style, VOICE);
    expect(synthesize(t)).toEqual(synthesize(t));
  });

  it('never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random is forbidden');
    });
    for (const style of STYLE_LIST) synthesize(buildTimeline('Hello 42', style, VOICE));
    spy.mockRestore();
  });

  it.each(STYLE_LIST.map((s) => [s.id, s] as const))('%s sounds inside every event and is silent between them', (_, style) => {
    const t = buildTimeline('ab cd', style, { ...VOICE, speed: 10 });
    const data = synthesize(t);
    for (const e of t.events) {
      expect(rms(slice(data, e.start, e.start + e.duration))).toBeGreaterThan(0.01);
    }
    for (let i = 1; i < t.events.length; i++) {
      const gap = slice(data, t.events[i - 1].start + t.events[i - 1].duration + 0.001, t.events[i].start - 0.001);
      expect(gap.every((x) => x === 0)).toBe(true);
    }
  });

  it('plays the requested frequency', () => {
    const data = synthesize(single({ frequency: 440 }, 0.5));
    // Two zero crossings per period, over the 0.5 s sustained part.
    expect(crossings(slice(data, 0.01, 0.49)) / 0.48 / 2).toBeCloseTo(440, -1);
  });

  it('glides down when glide is negative', () => {
    const data = synthesize(single({ frequency: 880, glide: -12 }, 1));
    const first = crossings(slice(data, 0.01, 0.2));
    const last = crossings(slice(data, 0.8, 0.99));
    expect(first / last).toBeGreaterThan(1.5);
  });

  it('starts and ends each event at zero (no clicks)', () => {
    for (const waveform of ['square', 'sawtooth', 'sine', 'triangle'] as const) {
      const data = synthesize(single({ waveform }, 0.1));
      expect(Math.abs(data[0])).toBeLessThan(0.01);
      expect(Math.abs(data[Math.round(0.1 * SR) - 1])).toBeLessThan(0.01);
    }
  });

  it('limits the peak to 0.98 (R5.5)', () => {
    const data = synthesize(single({ waveform: 'sawtooth', frequency: 110, formants: [500, 900], gain: 1 }));
    const peak = data.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    expect(peak).toBeLessThanOrEqual(0.98 + 1e-6);
    expect(peak).toBeGreaterThan(0.9);
  });

  it('synthesizes 500 characters at the slowest speed in under 250 ms per style (R5.4)', () => {
    const text = 'The quick brown fox jumps over the lazy dog, again and again! '.repeat(9).slice(0, 500);
    for (const style of STYLE_LIST) {
      const t = buildTimeline(text, style, { pitch: 0, speed: 5, variation: 0.3 });
      const t0 = performance.now();
      synthesize(t);
      expect(performance.now() - t0).toBeLessThan(250);
    }
  });
});

describe('alphabet vowels (R3.9)', () => {
  /** Energy around `f` (±100 Hz) via Goertzel at 10 Hz steps, in dB. */
  function bandDb(data: Float32Array, f: number): number {
    let energy = 0;
    for (let freq = f - 100; freq <= f + 100; freq += 10) {
      const w = (2 * Math.PI * freq) / SR;
      const coeff = 2 * Math.cos(w);
      let s1 = 0;
      let s2 = 0;
      for (const x of data) {
        const s0 = x + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      energy += s1 * s1 + s2 * s2 - coeff * s1 * s2;
    }
    return 10 * Math.log10(energy);
  }

  const NAMES = ['a', 'e', 'i', 'o', 'u'] as const;
  // At 100 Hz the harmonics sample the vowel envelope densely; at the real ~240 Hz
  // the result would depend on where harmonics happen to fall.
  const sustains = NAMES.map((v) =>
    slice(synthesize(single({ ...LETTER_SOUNDS[v].sound, frequency: 100, glide: 0 }, 0.3)), 0.05, 0.25),
  );
  // dB in each band relative to the mean of the five vowels: removes the spectral tilt shared by all.
  const relativeDb = (i: number, f: number) =>
    bandDb(sustains[i], f) - sustains.reduce((sum, _, j) => sum + bandDb(sustains[j], f), 0) / NAMES.length;

  it.each(NAMES.map((v, i) => [v, i] as const))('%s is closest to its own formants', (vowel, i) => {
    const score = (t: (typeof NAMES)[number]) => VOWELS[t].reduce((sum, r) => sum + relativeDb(i, r.frequency), 0);
    expect(NAMES.toSorted((x, y) => score(y) - score(x))[0]).toBe(vowel);
  });
});
