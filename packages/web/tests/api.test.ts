import { describe, expect, it } from 'vitest';
import { encodeWav, init, MumbleError, render, Speaker, timeline, type Voice } from '../src/index.js';

describe('before init', () => {
  it('throws a clear error', async () => {
    // Fresh module instance: vitest isolates test files, and this file has not called init() yet.
    expect(() => render('a', { style: 'beep' })).toThrow(/await init\(\)/);
    await init();
    await init(); // idempotent
    expect(render('a', { style: 'beep' }).samples.length).toBeGreaterThan(0);
  });
});

describe('API', () => {
  it('applies voice defaults (pitch 0, speed 15, variation 0, seed 0) and 48 kHz', async () => {
    await init();
    const implicit = render('Hello', { style: 'grunt' });
    const explicit = render('Hello', { style: 'grunt', pitch: 0, speed: 15, variation: 0, seed: 0 }, 48_000);
    expect(implicit).toEqual(explicit);
    expect(implicit.sampleRate).toBe(48_000);
  });

  it('timeline matches the render timeline (L2.2)', async () => {
    await init();
    const voice: Voice = { style: 'alphabet', variation: 0.4, seed: 3 };
    expect(timeline('Perché no? 👋', voice)).toEqual(render('Perché no? 👋', voice).timeline);
  });

  it('gives UTF-16 offsets that index JavaScript strings (L2.3)', async () => {
    await init();
    const text = 'è👋 a';
    const chars = timeline(text, { style: 'beep' }).events.map((e) => text.slice(e.utf16Start, e.utf16Start + e.utf16Length));
    expect(chars).toEqual(['è', '👋', 'a']);
  });

  it('maps core errors to MumbleError codes', async () => {
    await init();
    const codeOf = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof MumbleError ? e.code : `not a MumbleError: ${e}`;
      }
      return 'no error';
    };
    expect(codeOf(() => render('a', { style: 'beep', speed: 31 }))).toBe('SpeedOutOfRange');
    expect(codeOf(() => new Speaker({ style: 'beep' }, 7_999))).toBe('SampleRateOutOfRange');
    expect(codeOf(() => timeline('a', { style: 'nope' as Voice['style'] }))).toBe('UnknownStyle');
  });

  it('encodes WAV files (L2.4)', async () => {
    await init();
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 44_100);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(44 + 6);
  });
});

describe('Speaker (L3)', () => {
  /** Places each grapheme's utterance at the cumulative advance, like a game engine would. */
  function typewrite(text: string, voice: Voice, sampleRate: number): Float32Array {
    const speaker = new Speaker(voice, sampleRate);
    const parts: { offset: number; samples: Float32Array }[] = [];
    let t = 0;
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
      const u = speaker.next(segment);
      parts.push({ offset: Math.round(t * sampleRate), samples: u.samples });
      t += u.advance;
    }
    speaker.free();
    // Pauses have an offset but no samples: they do not extend the audio.
    const sounds = parts.filter((p) => p.samples.length > 0);
    const out = new Float32Array(Math.max(0, ...sounds.map((p) => p.offset + p.samples.length)));
    for (const p of sounds) out.set(p.samples, p.offset);
    return out;
  }

  it.each(['beep', 'grunt', 'alphabet'] as const)('%s matches render bit for bit (L3.2)', async (style) => {
    await init();
    const voice: Voice = { style, pitch: 3, variation: 0.4, seed: 11 };
    for (const text of ['Hello, world!', 'Perché è così? Sì!', 'a\nb  c...', '👋 #42']) {
      const rendered = render(text, voice, 44_100).samples;
      const typed = typewrite(text, voice, 44_100);
      expect(Array.from(typed)).toEqual(Array.from(rendered.subarray(0, typed.length)));
      expect(rendered.subarray(typed.length).every((x) => x === 0)).toBe(true);
    }
  });

  it('returns silence and no sound for pauses, and resets', async () => {
    await init();
    const speaker = new Speaker({ style: 'grunt', speed: 10 });
    const pause = speaker.next('.');
    expect(pause.samples.length).toBe(0);
    expect(pause.sound).toBeNull();
    expect(pause.advance).toBeCloseTo(0.4, 12);
    const first = speaker.next('a');
    expect(first.sound?.style).toBe('grunt');
    expect(first.sound?.variant).toBeGreaterThanOrEqual(0);
    expect(first.sound?.variant).toBeLessThanOrEqual(3);
    speaker.reset();
    speaker.next('.');
    expect(speaker.next('a')).toEqual(first);
    speaker.free();
  });
});

describe('performance (L2.5)', () => {
  it('renders 500 characters at the slowest speed in under 150 ms per style', async () => {
    await init();
    // Budget is for a mid-range laptop; CI runners get a slack factor (LD10).
    const budget = 150 * Number(process.env.MUMBLE_PERF_SLACK ?? 1);
    const text = 'The quick brown fox jumps over the lazy dog, again and again! '.repeat(9).slice(0, 500);
    for (const style of ['beep', 'grunt', 'alphabet'] as const) {
      render(text, { style, speed: 5, variation: 0.3 }); // warm-up
      const t0 = performance.now();
      render(text, { style, speed: 5, variation: 0.3 });
      expect(performance.now() - t0).toBeLessThan(budget);
    }
  });
});
