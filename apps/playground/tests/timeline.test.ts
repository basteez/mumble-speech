import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTimeline, TAIL_SECONDS } from '../src/core/timeline.ts';
import type { Style, Voice } from '../src/core/types.ts';

const fake: Style = {
  id: 'beep',
  label: 'Fake',
  description: '',
  reference: '',
  voice: () => ({
    sound: { waveform: 'square', frequency: 100, durationRatio: 0.5, gain: 0.5 },
    dot: { color: 'red', size: 'md' },
  }),
};

const voice = (v: Partial<Voice> = {}): Voice => ({ pitch: 0, speed: 10, variation: 0, ...v });

afterEach(() => vi.restoreAllMocks());

describe('buildTimeline scheduling (R3.6, R3.7)', () => {
  it('advances one slot per sounding token', () => {
    const { events } = buildTimeline('abc', fake, voice());
    expect(events.map((e) => e.start)).toEqual([0, 0.1, 0.2].map((x) => expect.closeTo(x, 10)));
    expect(events.map((e) => e.tokenIndex)).toEqual([0, 1, 2]);
  });

  it.each([
    ['a b', 2],
    ['a,b', 3],
    ['a.b', 5],
    ['a\nb', 5],
  ])('%j puts the second sound %d slots after the first', (text, slots) => {
    const { events } = buildTimeline(text, fake, voice());
    expect(events[1].start).toBeCloseTo(slots * 0.1, 10);
  });

  it('never overlaps events', () => {
    const { events } = buildTimeline('Hello, world! How are you?', fake, voice({ speed: 30 }));
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1].start + events[i - 1].duration).toBeLessThanOrEqual(events[i].start);
    }
  });

  it('uses durationRatio of the slot', () => {
    const { events } = buildTimeline('a', fake, voice({ speed: 5 }));
    expect(events[0].duration).toBeCloseTo(0.1, 10);
  });
});

describe('buildTimeline duration (R7.4)', () => {
  it('ends at the last sound plus the tail, excluding trailing pauses', () => {
    const { duration } = buildTimeline('ab...   ', fake, voice());
    expect(duration).toBeCloseTo(0.1 + 0.05 + TAIL_SECONDS, 10);
  });

  it('is 0 without sounds', () => {
    expect(buildTimeline('...', fake, voice()).duration).toBe(0);
  });
});

describe('buildTimeline voice (R4.2, R4.3)', () => {
  it('transposes by 2^(semitones/12)', () => {
    const up = buildTimeline('a', fake, voice({ pitch: 12 }));
    const down = buildTimeline('a', fake, voice({ pitch: -7 }));
    expect(up.events[0].sound.frequency).toBeCloseTo(200, 10);
    expect(down.events[0].sound.frequency).toBeCloseTo(100 * 2 ** (-7 / 12), 10);
  });

  it('keeps variation within ±variation×2 semitones', () => {
    const text = 'x'.repeat(500);
    const { events } = buildTimeline(text, fake, voice({ variation: 0.5 }));
    const semis = events.map((e) => 12 * Math.log2(e.sound.frequency / 100));
    expect(Math.max(...semis)).toBeLessThanOrEqual(1);
    expect(Math.min(...semis)).toBeGreaterThanOrEqual(-1);
    expect(new Set(semis).size).toBeGreaterThan(1);
  });

  it('applies no variation at 0', () => {
    const { events } = buildTimeline('hello', fake, voice());
    expect(new Set(events.map((e) => e.sound.frequency))).toEqual(new Set([100]));
  });
});

describe('buildTimeline determinism (R3.8)', () => {
  it('returns identical timelines for identical input', () => {
    const v = voice({ variation: 1 });
    expect(buildTimeline('Hello there', fake, v)).toEqual(buildTimeline('Hello there', fake, v));
  });

  it('never calls Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random is forbidden in the core');
    });
    expect(() => buildTimeline('Hello', fake, voice({ variation: 1 }))).not.toThrow();
  });

  it('passes the previous style sound to the style', () => {
    const seen: (number | null)[] = [];
    const spy: Style = {
      ...fake,
      voice: (token, rng, prev) => {
        seen.push(prev?.frequency ?? null);
        return { sound: { ...fake.voice(token, rng, prev).sound, frequency: token.index }, dot: fake.voice(token, rng, prev).dot };
      },
    };
    buildTimeline('ab c', spy, voice({ pitch: 5 }));
    expect(seen).toEqual([null, 0, 1]);
  });
});
