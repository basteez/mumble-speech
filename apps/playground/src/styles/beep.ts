import type { Dot, SoundSpec, Style } from '../core/types.ts';

const SOUND: SoundSpec = Object.freeze({ waveform: 'square', frequency: 520, durationRatio: 0.5, gain: 0.35 });
const DOT: Dot = Object.freeze({ color: 'var(--teal)', size: 'md' });

/** One beep for every letter (R3.1). */
export const beep: Style = {
  id: 'beep',
  label: 'One beep for every letter',
  description: 'The same short beep for every character.',
  reference: 'Undertale',
  voice: () => ({ sound: SOUND, dot: DOT }),
};
