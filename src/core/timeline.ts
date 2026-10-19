import { fnv1a, mulberry32 } from './rng.ts';
import { isAudible, tokenize } from './tokenize.ts';
import type { SoundEvent, SoundSpec, Style, Timeline, TokenKind, Voice } from './types.ts';

/** Silence after the last sound, in seconds (R7.4). */
export const TAIL_SECONDS = 0.05;

/** Slots taken by each token kind (R3.6). */
const SLOTS: Record<TokenKind, number> = {
  letter: 1,
  digit: 1,
  other: 1,
  space: 1,
  'pause-short': 2,
  'pause-long': 4,
};

/** Text → timeline. Pure and deterministic for a given text, style and voice (R3.8). */
export function buildTimeline(text: string, style: Style, voice: Voice): Timeline {
  const tokens = tokenize(text);
  const rng = mulberry32(fnv1a(`${style.id}\u0000${text}`));
  const slot = 1 / voice.speed;
  const events: SoundEvent[] = [];
  let prev: SoundSpec | null = null;
  let t = 0;

  for (const token of tokens) {
    if (isAudible(token)) {
      const { sound, dot } = style.voice(token, rng, prev);
      // Always consumed, so the style's random sequence does not depend on the variation.
      const jitter = rng() * 2 - 1;
      const semitones = voice.pitch + jitter * voice.variation * 2;
      events.push({
        tokenIndex: token.index,
        start: t,
        duration: sound.durationRatio * slot,
        sound: { ...sound, frequency: sound.frequency * 2 ** (semitones / 12) },
        dot,
      });
      prev = sound;
    }
    t += SLOTS[token.kind] * slot;
  }

  const last = events.at(-1);
  const duration = last ? last.start + last.duration + TAIL_SECONDS : 0;
  return { tokens, events, duration };
}

/** The event sounding at time `t`, or null between sounds (R6.3). Binary search on sorted events. */
export function eventAt(events: readonly SoundEvent[], t: number): SoundEvent | null {
  let lo = 0;
  let hi = events.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = events[mid];
    if (t < e.start) hi = mid - 1;
    else if (t >= e.start + e.duration) lo = mid + 1;
    else return e;
  }
  return null;
}
