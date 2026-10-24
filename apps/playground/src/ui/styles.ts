import type { StyleId } from '@mumble-speech/web';

/** Text of the style cards (R2.1). The sound itself comes from the library. */
export const STYLE_CARDS: readonly { id: StyleId; label: string; description: string; reference: string }[] = [
  { id: 'beep', label: 'One beep for every letter', description: 'The same short beep for every character.', reference: 'Undertale' },
  { id: 'grunt', label: 'A few grunts for each character', description: 'A small set of grunts, one per character.', reference: 'Banjo-Kazooie' },
  { id: 'alphabet', label: 'A sound for every letter of the alphabet', description: 'Each letter has its own voiced sound.', reference: 'Animal Crossing' },
];

export const DEFAULT_STYLE: StyleId = 'beep';
