import type { SoundId } from '@mumble-speech/web';

export type DotSize = 'sm' | 'md' | 'lg';

export interface Dot {
  /** Any CSS color. */
  color: string;
  size: DotSize;
}

const GRUNT_DOTS: readonly Dot[] = [
  { color: 'var(--teal)', size: 'sm' },
  { color: 'var(--blue)', size: 'md' },
  { color: 'var(--olive)', size: 'lg' },
  { color: 'var(--orange)', size: 'md' },
];
const NEUTRAL_VARIANT = 26;

/** The dot drawn for a sound (R6.2): colors are a playground choice, see design §7.3. */
export function dotFor(sound: SoundId): Dot {
  switch (sound.style) {
    case 'beep':
      return { color: 'var(--teal)', size: 'md' };
    case 'grunt':
      return GRUNT_DOTS[sound.variant] ?? GRUNT_DOTS[0];
    case 'alphabet':
      return sound.variant === NEUTRAL_VARIANT
        ? { color: 'var(--muted)', size: 'md' }
        : { color: `hsl(${Math.round((sound.variant * 360) / 26)} 55% 55%)`, size: 'md' };
  }
}
