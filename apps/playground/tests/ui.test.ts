// UI-side logic of the playground. Sound, timeline and WAV encoding are tested in the library.
import type { MumbleEvent } from '@mumble-speech/web';
import { describe, expect, it, vi } from 'vitest';
import { createBufferCache } from '../src/audio/cache.ts';
import { eventAt } from '../src/ui/event-at.ts';
import { exportFilename } from '../src/ui/filename.ts';

describe('exportFilename (R7.3)', () => {
  it('formats style and local timestamp', () => {
    expect(exportFilename('beep', new Date(2026, 9, 19, 16, 30, 0))).toBe('mumble-beep-20261019-163000.wav');
    expect(exportFilename('alphabet', new Date(2026, 0, 2, 3, 4, 5))).toBe('mumble-alphabet-20260102-030405.wav');
  });
});

describe('createBufferCache (R7.2)', () => {
  const key = () => ({ text: 'Hello' });

  it('renders once per input and reuses the buffer for export', async () => {
    const render = vi.fn(async (k: object) => ({ k }));
    const cache = createBufferCache(render);
    const t = key();
    const played = await cache.get(t);
    const exported = await cache.get(t);
    expect(exported).toBe(played);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight render', async () => {
    const render = vi.fn(async (k: object) => ({ k }));
    const cache = createBufferCache(render);
    const t = key();
    const [a, b] = await Promise.all([cache.get(t), cache.get(t)]);
    expect(a).toBe(b);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('re-renders for a new input', async () => {
    const render = vi.fn(async (k: object) => ({ k }));
    const cache = createBufferCache(render);
    await cache.get(key());
    await cache.get(key());
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('forgets a failed render', async () => {
    const render = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    const cache = createBufferCache(render);
    const t = key();
    await expect(cache.get(t)).rejects.toThrow('boom');
    await expect(cache.get(t)).resolves.toBe('ok');
  });
});

describe('eventAt (R6.3)', () => {
  const ev = (start: number, duration: number): MumbleEvent => ({
    graphemeIndex: 0,
    utf8Start: 0,
    utf8Length: 1,
    utf16Start: 0,
    utf16Length: 1,
    start,
    duration,
    dot: { color: '#ff0000', size: 'md' },
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
