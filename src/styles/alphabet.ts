import type { Dot, Resonance, SoundSpec, Style } from '../core/types.ts';

// See specs/design.md §5.3 (D4, D9).

type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';

const r = (frequency: number, bandwidth: number): Resonance => Object.freeze({ frequency, bandwidth });

/** Italian vowel formants F1–F3 for a mid-high voice (R3.9). */
export const VOWELS: Record<Vowel, readonly Resonance[]> = {
  a: [r(850, 90), r(1400, 110), r(2800, 170)],
  e: [r(450, 80), r(2200, 110), r(2900, 170)],
  i: [r(310, 70), r(2600, 120), r(3300, 200)],
  o: [r(500, 80), r(900, 100), r(2800, 170)],
  u: [r(340, 70), r(800, 100), r(2700, 170)],
};
const SCHWA: readonly Resonance[] = [r(550, 90), r(1550, 110), r(2650, 170)];

/** Vowel letters play themselves; consonants the vowel of their English name, Animalese-style. */
const VOWEL_OF: Record<string, Vowel> = {};
for (const [letters, vowel] of [
  ['bcdgptvz', 'i'],
  ['flmnsxhjk', 'e'],
  ['ry', 'a'],
  ['qw', 'u'],
  ['a', 'a'],
  ['e', 'e'],
  ['i', 'i'],
  ['o', 'o'],
  ['u', 'u'],
] as const) {
  for (const letter of letters) VOWEL_OF[letter] = vowel;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const IS_VOWEL = /[aeiou]/;
const BASE_HZ = 240;
/** Speech-like pitch fall inside each syllable. */
const GLIDE = -1.5;

/** One sound per letter (R3.4). Timbre tells letters apart, pitch barely moves (R3.10). */
export const LETTER_SOUNDS: Record<string, { sound: SoundSpec; dot: Dot }> = Object.fromEntries(
  Array.from(LETTERS, (letter, n) => {
    const offset = (((n * 7) % 5) - 2) * 0.5;
    const sound: SoundSpec = {
      waveform: 'sawtooth',
      frequency: BASE_HZ * 2 ** (offset / 12),
      glide: GLIDE,
      durationRatio: 0.85,
      vocalTract: [...VOWELS[VOWEL_OF[letter]]],
      gain: 0.4,
    };
    if (!IS_VOWEL.test(letter)) sound.noiseBurst = { centerHz: 1500 + n * 250, durationMs: 12 };
    const dot: Dot = { color: `hsl(${Math.round((n * 360) / 26)} 55% 55%)`, size: 'md' };
    return [letter, Object.freeze({ sound: Object.freeze(sound), dot: Object.freeze(dot) })];
  }),
);

/** Schwa shared by digits and other characters (R3.5). */
export const NEUTRAL_SOUND: SoundSpec = Object.freeze<SoundSpec>({
  waveform: 'sawtooth',
  frequency: BASE_HZ,
  glide: GLIDE,
  durationRatio: 0.85,
  vocalTract: [...SCHWA],
  gain: 0.4,
});
const NEUTRAL = Object.freeze({ sound: NEUTRAL_SOUND, dot: Object.freeze<Dot>({ color: 'var(--muted)', size: 'md' }) });

/** A sound for every letter of the alphabet. */
export const alphabet: Style = {
  id: 'alphabet',
  label: 'A sound for every letter of the alphabet',
  description: 'Each letter has its own voiced sound.',
  reference: 'Animal Crossing',
  voice: (token) => (token.kind === 'letter' ? LETTER_SOUNDS[token.base] : NEUTRAL),
};
