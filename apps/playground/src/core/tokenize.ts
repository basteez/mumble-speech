import { normalize } from './normalize.ts';
import type { Token, TokenKind } from './types.ts';

const LONG_PAUSE = new Set(['.', '!', '?', '…']);
const SHORT_PAUSE = new Set([',', ';', ':']);
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function classify(char: string, base: string): TokenKind {
  if (char.includes('\n') || LONG_PAUSE.has(char)) return 'pause-long';
  if (SHORT_PAUSE.has(char)) return 'pause-short';
  if (/^\s+$/u.test(char)) return 'space';
  if (/^[a-z]$/.test(base)) return 'letter';
  if (/^[0-9]$/.test(base)) return 'digit';
  return 'other';
}

/** Splits text into graphemes and classifies each one (R1.5). */
export function tokenize(text: string): Token[] {
  return Array.from(segmenter.segment(text), ({ segment }, index) => {
    const base = normalize(segment);
    return { index, char: segment, base, kind: classify(segment, base) };
  });
}

export function isAudible(token: Token): boolean {
  return token.kind === 'letter' || token.kind === 'digit' || token.kind === 'other';
}

/** False when nothing in the text would make a sound (R1.3). */
export function hasAudibleTokens(tokens: Token[]): boolean {
  return tokens.some(isAudible);
}
