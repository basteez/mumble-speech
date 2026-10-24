import { describe, expect, it, vi } from 'vitest';
import { createBufferCache } from '../src/audio/cache.ts';
import { encodeWav } from '../src/audio/wav.ts';
import { eventAt } from '../src/core/timeline.ts';
import type { SoundEvent, Timeline } from '../src/core/types.ts';
import { exportFilename } from '../src/ui/filename.ts';

const ascii = (view: DataView, offset: number, length: number) =>
  String.fromCharCode(...Array.from({ length }, (_, i) => view.getUint8(offset + i)));

describe('encodeWav (R7.1, R5.5)', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
  const wav = encodeWav(samples, 44100);
  const view = new DataView(wav);

  it('writes a 16-bit mono PCM header', () => {
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('is 44 + 2·n bytes long', () => {
    expect(wav.byteLength).toBe(44 + samples.length * 2);
  });

  it('converts and clamps samples', () => {
    const pcm = Array.from({ length: samples.length }, (_, i) => view.getInt16(44 + i * 2, true));
    expect(pcm).toEqual([0, 16383, -16384, 32767, -32768, 32767, -32768]);
  });

  it('round-trips within 1 LSB', () => {
    const input = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10) * 0.9);
    const out = new DataView(encodeWav(input, 44100));
    input.forEach((x, i) => {
      const s = out.getInt16(44 + i * 2, true);
      const decoded = s < 0 ? s / 0x8000 : s / 0x7fff;
      expect(Math.abs(decoded - x)).toBeLessThanOrEqual(1 / 0x7fff);
    });
  });
});

describe('exportFilename (R7.3)', () => {
  it('formats style and local timestamp', () => {
    expect(exportFilename('beep', new Date(2026, 9, 19, 16, 30, 0))).toBe('mumble-beep-20261019-163000.wav');
    expect(exportFilename('alphabet', new Date(2026, 0, 2, 3, 4, 5))).toBe('mumble-alphabet-20260102-030405.wav');
  });
});

describe('createBufferCache (R7.2)', () => {
  const timeline = (): Timeline => ({ tokens: [], events: [], duration: 1 });

  it('renders once per timeline and reuses the buffer for export', async () => {
    const render = vi.fn(async (t: Timeline) => ({ t }));
    const cache = createBufferCache(render);
    const t = timeline();
    const played = await cache.get(t);
    const exported = await cache.get(t);
    expect(exported).toBe(played);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight render', async () => {
    const render = vi.fn(async (t: Timeline) => ({ t }));
    const cache = createBufferCache(render);
    const t = timeline();
    const [a, b] = await Promise.all([cache.get(t), cache.get(t)]);
    expect(a).toBe(b);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('re-renders for a new timeline', async () => {
    const render = vi.fn(async (t: Timeline) => ({ t }));
    const cache = createBufferCache(render);
    await cache.get(timeline());
    await cache.get(timeline());
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('forgets a failed render', async () => {
    const render = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    const cache = createBufferCache(render);
    const t = timeline();
    await expect(cache.get(t)).rejects.toThrow('boom');
    await expect(cache.get(t)).resolves.toBe('ok');
  });
});

describe('eventAt (R6.3)', () => {
  const ev = (start: number, duration: number): SoundEvent => ({
    tokenIndex: start * 10,
    start,
    duration,
    sound: { waveform: 'sine', frequency: 1, durationRatio: 0.5, gain: 1 },
    dot: { color: 'red', size: 'md' },
  });
  const events = [ev(0, 0.05), ev(0.1, 0.05), ev(0.5, 0.05)];

  it.each([
    [-0.01, null],
    [0, 0],
    [0.049, 0],
    [0.05, null],
    [0.12, 1],
    [0.3, null],
    [0.52, 2],
    [9, null],
  ])('at %f returns event %s', (t, expected) => {
    const found = eventAt(events, t);
    expect(found === null ? null : events.indexOf(found)).toBe(expected);
  });

  it('handles an empty list', () => {
    expect(eventAt([], 0)).toBeNull();
  });
});
