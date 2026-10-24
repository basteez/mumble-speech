// The conformance vectors through WebAssembly must match the native core bit for bit (L1.4, L5.2).

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { init, MumbleError, render, type StyleId } from '../src/index.js';

interface Vector {
  id: string;
  text: string;
  voice: { style: StyleId; pitch: number; speed: number; variation: number; seed: number };
  sampleRate: number;
  expected:
    | { error: string }
    | {
        sampleCount: number;
        pcmHash: string;
        duration: number;
        events: {
          grapheme: number;
          utf8: [number, number];
          utf16: [number, number];
          start: number;
          duration: number;
          variant: number;
        }[];
      };
}

const file = JSON.parse(readFileSync(new URL('../../../conformance/vectors.json', import.meta.url), 'utf8')) as {
  version: number;
  vectors: Vector[];
};

/** 64-bit FNV-1a over the little-endian bytes of the samples (LD7). */
function pcmHash(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `0x${hash.toString(16).padStart(16, '0')}`;
}

beforeAll(() => init());

describe('conformance vectors', () => {
  it('uses format version 2', () => {
    expect(file.version).toBe(2);
    expect(file.vectors.length).toBeGreaterThanOrEqual(30);
  });

  it.each(file.vectors.map((v) => [v.id, v] as const))('%s', (_, v) => {
    if ('error' in v.expected) {
      const code = v.expected.error;
      expect(() => render(v.text, v.voice, v.sampleRate)).toThrow(expect.objectContaining({ code }));
      expect(() => render(v.text, v.voice, v.sampleRate)).toThrow(MumbleError);
      return;
    }
    const r = render(v.text, v.voice, v.sampleRate);
    expect(r.samples.length).toBe(v.expected.sampleCount);
    expect(pcmHash(r.samples)).toBe(v.expected.pcmHash);
    expect(r.timeline.duration).toBe(v.expected.duration);
    expect(
      r.timeline.events.map((e) => ({
        grapheme: e.graphemeIndex,
        utf8: [e.utf8Start, e.utf8Length],
        utf16: [e.utf16Start, e.utf16Length],
        start: e.start,
        duration: e.duration,
        variant: e.sound.variant,
      })),
    ).toEqual(v.expected.events);
    expect(r.timeline.events.every((e) => e.sound.style === v.voice.style)).toBe(true);
  });
});
