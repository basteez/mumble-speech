import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng.ts';
import { buildTimeline } from '../src/core/timeline.ts';
import { tokenize } from '../src/core/tokenize.ts';
import type { Voice } from '../src/core/types.ts';
import { alphabet, LETTER_SOUNDS, NEUTRAL_SOUND, VOWELS } from '../src/styles/alphabet.ts';
import { beep } from '../src/styles/beep.ts';
import { grunt, GRUNTS } from '../src/styles/grunt.ts';
import { STYLE_LIST, STYLES } from '../src/styles/index.ts';

const VOICE: Voice = { pitch: 0, speed: 15, variation: 0 };
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCàè0123456789   ,.!?#';

function randomTexts(count: number): string[] {
  const rng = mulberry32(1234);
  return Array.from({ length: count }, () => {
    const length = 1 + Math.floor(rng() * 120);
    return Array.from({ length }, () => CHARSET[Math.floor(rng() * CHARSET.length)]).join('');
  });
}

describe('beep (R3.1, R6.2)', () => {
  it('plays the same frequency for every sounding char at variation 0', () => {
    const { events } = buildTimeline('Hello, wörld 42 #!', beep, VOICE);
    expect(events).toHaveLength(13);
    expect(new Set(events.map((e) => e.sound.frequency)).size).toBe(1);
  });

  it('uses the same dot everywhere', () => {
    const { events } = buildTimeline('Hello 42', beep, VOICE);
    expect(new Set(events.map((e) => JSON.stringify(e.dot))).size).toBe(1);
  });
});

describe('grunt (R3.2, R3.3, R6.2)', () => {
  it('has exactly 4 grunts, distinct in pitch, duration, timbre and dot', () => {
    expect(GRUNTS).toHaveLength(4);
    for (const key of ['frequency', 'durationRatio', 'glide'] as const) {
      expect(new Set(GRUNTS.map((g) => g.sound[key])).size).toBe(4);
    }
    expect(new Set(GRUNTS.map((g) => g.sound.formants!.join())).size).toBe(4);
    expect(new Set(GRUNTS.map((g) => JSON.stringify(g.dot))).size).toBe(4);
  });

  it('never plays the same grunt twice in a row on 200 random texts', () => {
    for (const text of randomTexts(200)) {
      const { events } = buildTimeline(text, grunt, VOICE);
      for (let i = 1; i < events.length; i++) {
        expect(events[i].dot).not.toEqual(events[i - 1].dot);
      }
    }
  });

  it('uses all 4 grunts on a long text', () => {
    const { events } = buildTimeline('the quick brown fox jumps over the lazy dog', grunt, VOICE);
    expect(new Set(events.map((e) => JSON.stringify(e.dot))).size).toBe(4);
  });
});

describe('alphabet (R3.4, R3.5, R6.2)', () => {
  it('has 26 distinct letter sounds', () => {
    expect(Object.keys(LETTER_SOUNDS)).toHaveLength(26);
    const specs = Object.values(LETTER_SOUNDS).map((l) => JSON.stringify(l.sound));
    expect(new Set(specs).size).toBe(26);
  });

  it('has 26 distinct colors and a constant size', () => {
    const dots = Object.values(LETTER_SOUNDS).map((l) => l.dot);
    expect(new Set(dots.map((d) => d.color)).size).toBe(26);
    expect(new Set(dots.map((d) => d.size))).toEqual(new Set(['md']));
  });

  it('always plays the same sound for the same letter', () => {
    const { events, tokens } = buildTimeline('Banana à la carte, BANANA!', alphabet, VOICE);
    const byLetter = new Map<string, string>();
    for (const e of events) {
      const base = tokens[e.tokenIndex].base;
      const spec = JSON.stringify(e.sound);
      expect(byLetter.get(base) ?? spec).toBe(spec);
      byLetter.set(base, spec);
    }
  });

  it('makes each vowel letter play its own vowel (R3.9)', () => {
    for (const v of 'aeiou') expect(LETTER_SOUNDS[v].sound.vocalTract).toEqual(VOWELS[v as keyof typeof VOWELS]);
  });

  it('keeps base pitch within ±1 semitone across letters (R3.10)', () => {
    for (const { sound } of Object.values(LETTER_SOUNDS)) {
      expect(Math.abs(12 * Math.log2(sound.frequency / 240))).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('plays the neutral sound for digits and other chars', () => {
    const rng = mulberry32(1);
    for (const token of tokenize('7#ж👋')) {
      expect(alphabet.voice(token, rng, null).sound).toEqual(NEUTRAL_SOUND);
    }
  });
});

describe('registry and snapshots (R3.8)', () => {
  it('lists the three styles in order with beep first', () => {
    expect(STYLE_LIST.map((s) => s.id)).toEqual(['beep', 'grunt', 'alphabet']);
    for (const s of STYLE_LIST) expect(STYLES[s.id]).toBe(s);
  });

  it.each(STYLE_LIST.map((s) => [s.id, s] as const))('%s timeline of "Hello, world!"', (_, style) => {
    const { events, duration } = buildTimeline('Hello, world!', style, { pitch: 2, speed: 15, variation: 0.3 });
    expect({ duration, events }).toMatchSnapshot();
  });
});
