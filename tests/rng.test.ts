import { describe, expect, it } from 'vitest';
import { fnv1a, mulberry32 } from '../src/core/rng.ts';

describe('fnv1a', () => {
  it('matches reference values', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });
});

describe('mulberry32 (R3.8)', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 100 }, a);
    const seqB = Array.from({ length: 100 }, b);
    expect(seqA).toEqual(seqB);
  });

  it('differs for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('returns values in [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('matches pinned values', () => {
    const rng = mulberry32(0);
    expect(Array.from({ length: 3 }, rng)).toMatchInlineSnapshot(`
      [
        0.26642920868471265,
        0.0003297457005828619,
        0.2232720274478197,
      ]
    `);
  });
});
