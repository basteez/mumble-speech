import { describe, expect, it } from 'vitest';
import { normalize } from '../src/core/normalize.ts';
import { hasAudibleTokens, tokenize } from '../src/core/tokenize.ts';

const kinds = (text: string) => tokenize(text).map((t) => t.kind);

describe('normalize (R1.4)', () => {
  it('strips diacritics and lowercases', () => {
    expect(['è', 'É', 'ñ', 'ü', 'Å', 'ç'].map(normalize)).toEqual(['e', 'e', 'n', 'u', 'a', 'c']);
  });

  it('leaves characters without a base letter alone', () => {
    expect(normalize('ß')).toBe('ß');
    expect(normalize('ж')).toBe('ж');
  });
});

describe('tokenize (R1.5)', () => {
  it('classifies every category', () => {
    expect(kinds('Ab 1,;:.!?…\n\t#')).toEqual([
      'letter', 'letter', 'space', 'digit',
      'pause-short', 'pause-short', 'pause-short',
      'pause-long', 'pause-long', 'pause-long', 'pause-long', 'pause-long',
      'space', 'other',
    ]);
  });

  it('treats accented letters as letters with a base', () => {
    expect(tokenize('Perché')).toMatchObject([
      { base: 'p' }, { base: 'e' }, { base: 'r' }, { base: 'c' }, { base: 'h' },
      { char: 'é', base: 'e', kind: 'letter' },
    ]);
  });

  it('counts composed emoji as a single other token', () => {
    const tokens = tokenize('a👨‍👩‍👧b');
    expect(tokens.map((t) => t.kind)).toEqual(['letter', 'other', 'letter']);
    expect(tokens.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it('treats CRLF as one long pause', () => {
    expect(kinds('a\r\nb')).toEqual(['letter', 'pause-long', 'letter']);
  });

  it('classifies non-Latin alphabets as other', () => {
    expect(kinds('жλ')).toEqual(['other', 'other']);
  });
});

describe('hasAudibleTokens (R1.3)', () => {
  it.each(['', '   ', '...!?', '... !!!'])('is false for %j', (text) => {
    expect(hasAudibleTokens(tokenize(text))).toBe(false);
  });

  it.each(['a', '1', '#', ' 👋 '])('is true for %j', (text) => {
    expect(hasAudibleTokens(tokenize(text))).toBe(true);
  });
});
