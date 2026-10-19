// Shared data model. See specs/design.md §3.

export type StyleId = 'beep' | 'grunt' | 'alphabet';

export type TokenKind = 'letter' | 'digit' | 'space' | 'pause-short' | 'pause-long' | 'other';

export interface Token {
  /** Position (in graphemes) in the original text, for the UI. */
  index: number;
  /** Original grapheme, shown in the UI. */
  char: string;
  /** Normalized lowercase grapheme, used by styles. */
  base: string;
  kind: TokenKind;
}

export interface Voice {
  /** Semitones, −12..12. */
  pitch: number;
  /** Characters per second, 5..30. */
  speed: number;
  /** 0..1. */
  variation: number;
}

export type Waveform = 'square' | 'sawtooth' | 'triangle' | 'sine';

/** What to play: abstract, independent from Web Audio. */
export interface SoundSpec {
  waveform: Waveform;
  /** Hz. Before pitch/variation in a style, after them in a SoundEvent. */
  frequency: number;
  /** Semitones of glide over the whole duration. */
  glide?: number;
  /** Fraction of the slot, (0, 0.9]. */
  durationRatio: number;
  /** Hz, parallel bandpass filters (grunt timbre). */
  formants?: [number, number];
  /** Cascade resonators (vowels, R3.9). */
  vocalTract?: Resonance[];
  /** Consonant attack. */
  noiseBurst?: { centerHz: number; durationMs: number };
  /** 0..1. */
  gain: number;
}

export interface Resonance {
  /** Hz. */
  frequency: number;
  /** Hz. */
  bandwidth: number;
}

export type DotSize = 'sm' | 'md' | 'lg';

export interface Dot {
  color: string;
  size: DotSize;
}

export interface SoundEvent {
  tokenIndex: number;
  /** Seconds from the start. */
  start: number;
  /** Seconds. */
  duration: number;
  /** Frequency already transposed and varied. */
  sound: SoundSpec;
  dot: Dot;
}

export interface Timeline {
  tokens: Token[];
  events: SoundEvent[];
  /** End of the last event + tail, in seconds. 0 when there are no events. */
  duration: number;
}

export type Rng = () => number;

export interface Style {
  id: StyleId;
  label: string;
  description: string;
  reference: string;
  /** Pure: same input → same output. `prev` is the previous sound, for R3.3. */
  voice(token: Token, rng: Rng, prev: SoundSpec | null): { sound: SoundSpec; dot: Dot };
}
