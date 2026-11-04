// Shareable URL (R9.2, R9.3, R9.11, R9.12): createUrlSync with fake timers, history and location.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, createUrlSync, type Settings } from '../src/ui/share-url.ts';

const ORIGIN = 'https://example.test';

/** A fake History and Location. replaceState moves `location` like a browser does. */
function fakeEnv(url: string) {
  const u = new URL(url, ORIGIN);
  const location = { pathname: u.pathname, search: u.search, hash: u.hash };
  const history = {
    state: { app: 'playground' } as unknown,
    replaceState: vi.fn((state: unknown, _title: string, next: string) => {
      const n = new URL(next, ORIGIN);
      location.pathname = n.pathname;
      location.search = n.search;
      location.hash = n.hash;
      history.state = state;
    }),
    pushState: vi.fn(),
  };
  return { history, location, current: () => location.pathname + location.search + location.hash };
}

const at = (overrides: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });

describe('createUrlSync (R9.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ten schedules within 250 ms produce one replaceState with the last settings', () => {
    const env = fakeEnv('/playground/');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    for (let i = 0; i < 10; i++) {
      sync.schedule(at({ text: `t${i}`, speed: 5 + i }));
      vi.advanceTimersByTime(20); // 9 gaps of 20 ms, all inside the window
    }
    expect(env.history.replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
    expect(env.current()).toBe('/playground/?text=t9&style=beep&pitch=0&speed=14&variation=0');
  });

  it('writes 250 ms after the last schedule, not after the first', () => {
    const env = fakeEnv('/');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ text: 'a' }));
    vi.advanceTimersByTime(200);
    sync.schedule(at({ text: 'ab' }));
    vi.advanceTimersByTime(249);
    expect(env.history.replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
    expect(env.location.search).toContain('text=ab');
  });

  it('a custom delayMs is honoured', () => {
    const env = fakeEnv('/');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location, delayMs: 50 });
    sync.schedule(at({ text: 'x' }));
    vi.advanceTimersByTime(49);
    expect(env.history.replaceState).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
  });

  it('uses replaceState and never pushState, passing the existing state through', () => {
    const env = fakeEnv('/');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ text: 'x' }));
    vi.runAllTimers();
    expect(env.history.replaceState).toHaveBeenCalledWith({ app: 'playground' }, '', expect.any(String));
    expect(env.history.pushState).not.toHaveBeenCalled();
  });

  it('keeps the path under /playground/ and the path of /', () => {
    for (const base of ['/playground/', '/']) {
      const env = fakeEnv(base);
      const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
      sync.schedule(at({ text: 'x' }));
      vi.runAllTimers();
      expect(env.location.pathname).toBe(base);
    }
  });

  it('preserves the fragment', () => {
    const env = fakeEnv('/playground/?text=a#about');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ text: 'b' }));
    vi.runAllTimers();
    expect(env.current()).toBe('/playground/?text=b&style=beep&pitch=0&speed=15&variation=0#about');
  });

  it('preserves foreign query parameters, after the owned ones', () => {
    const env = fakeEnv('/playground/?utm=x&text=a&ref=y#top');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ text: 'b' }));
    vi.runAllTimers();
    expect(env.current()).toBe('/playground/?text=b&style=beep&pitch=0&speed=15&variation=0&utm=x&ref=y#top');
  });

  it('a URL with an empty fragment and no query gets a canonical query', () => {
    const env = fakeEnv('/playground/#');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ style: 'grunt' }));
    vi.runAllTimers();
    expect(env.location.search).toBe('?text=Hello&style=grunt&pitch=0&speed=15&variation=0');
  });

  it('does not write when the query is already canonical', () => {
    const env = fakeEnv('/playground/?text=Hello&style=beep&pitch=0&speed=15&variation=0#frag');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({}));
    vi.advanceTimersByTime(1000);
    expect(env.history.replaceState).not.toHaveBeenCalled();
  });

  it('a non-canonical query with the same settings is rewritten once', () => {
    const env = fakeEnv('/?style=beep&text=Hello&pitch=0&speed=15&variation=0');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({}));
    vi.runAllTimers();
    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
    expect(env.location.search).toBe('?text=Hello&style=beep&pitch=0&speed=15&variation=0');
  });
});

describe('createUrlSync.flush (R9.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes immediately, without advancing the timers', () => {
    const env = fakeEnv('/playground/?pitch=3');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ pitch: 4 }));
    sync.flush();
    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
    expect(env.location.search).toBe('?text=Hello&style=beep&pitch=4&speed=15&variation=0');
  });

  it('cancels the pending timer, so no second write follows', () => {
    const env = fakeEnv('/');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ text: 'x' }));
    sync.flush();
    vi.runAllTimers();
    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
  });

  it('with nothing pending does nothing', () => {
    const env = fakeEnv('/');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.flush();
    vi.runAllTimers();
    expect(env.history.replaceState).not.toHaveBeenCalled();
  });

  it('initial load pattern: schedule + flush on a parameterised URL writes the canonical form once', () => {
    const env = fakeEnv('/playground/?text=Hi&variation=0.125');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ text: 'Hi', variation: 0.15 }));
    sync.flush();
    vi.runAllTimers();
    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
    expect(env.location.search).toBe('?text=Hi&style=beep&pitch=0&speed=15&variation=0.15');
  });
});

describe('createUrlSync failures (R9.11)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a SecurityError from replaceState is swallowed, and the next schedule writes', () => {
    const env = fakeEnv('/playground/');
    env.history.replaceState.mockImplementationOnce(() => {
      throw new DOMException('rate limited', 'SecurityError');
    });
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });

    sync.schedule(at({ text: 'first' }));
    expect(() => vi.advanceTimersByTime(250)).not.toThrow();
    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
    expect(env.current()).toBe('/playground/'); // the failed write left the URL alone

    sync.schedule(at({ text: 'second' }));
    vi.advanceTimersByTime(250);
    expect(env.history.replaceState).toHaveBeenCalledTimes(2);
    expect(env.location.search).toContain('text=second');
  });

  it('flush does not throw when replaceState throws', () => {
    const env = fakeEnv('/');
    env.history.replaceState.mockImplementationOnce(() => {
      throw new DOMException('rate limited', 'SecurityError');
    });
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ text: 'x' }));
    expect(() => sync.flush()).not.toThrow();
  });

  it('a failed write is not retried by the timer alone, only by the next change', () => {
    const env = fakeEnv('/');
    env.history.replaceState.mockImplementationOnce(() => {
      throw new DOMException('rate limited', 'SecurityError');
    });
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ text: 'x' }));
    vi.runAllTimers();
    expect(env.history.replaceState).toHaveBeenCalledTimes(1);
  });
});

describe('createUrlSync side effects (R9.12)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('makes no network request and does not reload', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const env = fakeEnv('/');
    const reload = vi.fn();
    const location = Object.assign(env.location, { reload });
    const sync = createUrlSync({ history: env.history as unknown as History, location });
    sync.schedule(at({ text: 'typing' }));
    sync.schedule(at({ text: 'typing more', pitch: 3 }));
    vi.runAllTimers();
    sync.flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('schedule itself does not touch history synchronously', () => {
    const env = fakeEnv('/');
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    sync.schedule(at({ text: 'x' }));
    expect(env.history.replaceState).not.toHaveBeenCalled();
    expect(env.history.pushState).not.toHaveBeenCalled();
  });
});
