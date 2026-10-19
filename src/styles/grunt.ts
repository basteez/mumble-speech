import type { Dot, SoundSpec, Style } from '../core/types.ts';

function g(frequency: number, glide: number, durationRatio: number, formants: [number, number], dot: Dot) {
  return Object.freeze({
    sound: Object.freeze<SoundSpec>({ waveform: 'sawtooth', frequency, glide, durationRatio, formants, gain: 0.5 }),
    dot: Object.freeze(dot),
  });
}

/** The voice's grunt set (R3.2). See specs/design.md §5.2. */
export const GRUNTS = [
  g(140, -3, 0.5, [600, 1000], { color: 'var(--teal)', size: 'sm' }),
  g(180, -5, 0.75, [700, 1200], { color: 'var(--blue)', size: 'md' }),
  g(110, -2, 0.9, [500, 900], { color: 'var(--olive)', size: 'lg' }),
  g(210, -6, 0.6, [800, 1400], { color: 'var(--orange)', size: 'md' }),
] as const;

/** A few grunts for each character, never the same twice in a row (R3.3). */
export const grunt: Style = {
  id: 'grunt',
  label: 'A few grunts for each character',
  description: 'A small set of grunts, one per character.',
  reference: 'Banjo-Kazooie',
  voice: (_token, rng, prev) => {
    const last = GRUNTS.findIndex((x) => x.sound === prev);
    let i = Math.floor(rng() * GRUNTS.length);
    if (i === last) i = (i + 1 + Math.floor(rng() * (GRUNTS.length - 1))) % GRUNTS.length;
    return GRUNTS[i];
  },
};
