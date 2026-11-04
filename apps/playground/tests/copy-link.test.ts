// Copy link (R9.13–R9.20, D15, D16): shareLink, createCopyLink, legacyCopy and the markup of the button.
// Fake clipboard, fake legacyCopy, recording render, fake timers and, where noted, a real createUrlSync
// on a fake history/location. The playground has no DOM environment in Vitest, so the fake document is plain objects.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import { DEFAULT_SETTINGS, createUrlSync, parseSettings, type Settings } from '../src/ui/share-url.ts';
import { createCopyLink, legacyCopy, shareLink, type CopyFeedback } from '../src/ui/copy-link.ts';

const ORIGIN = 'https://example.test';
const LINK = `${ORIGIN}/playground/?text=Hi&style=beep&pitch=0&speed=15&variation=0`;
const TEXT = '👩🏽‍🚀 & = + % # ? \'Ciao\'\nlinea 2';

const at = (overrides: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });

/** A promise the test resolves or rejects by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const notAllowed = () => new DOMException('Write permission denied.', 'NotAllowedError');

/** A fake History and Location; replaceState moves `location` like a browser does. */
function fakeBrowser(url: string) {
  const u = new URL(url, ORIGIN);
  const location = { origin: ORIGIN, pathname: u.pathname, search: u.search, hash: u.hash };
  const log: string[] = [];
  const history = {
    state: null as unknown,
    replaceState: vi.fn((state: unknown, _title: string, next: string) => {
      log.push(`replaceState ${next}`);
      const n = new URL(next, ORIGIN);
      location.pathname = n.pathname;
      location.search = n.search;
      location.hash = n.hash;
      history.state = state;
    }),
    pushState: vi.fn(),
  };
  const addressBar = () => ORIGIN + location.pathname + location.search + location.hash;
  return { history, location, log, addressBar };
}

/** Builds the deps the way main.ts does, with overridable fakes. `clipboard` may be passed as undefined. */
function makeCopy(
  over: {
    clipboard?: unknown;
    writeText?: (text: string) => Promise<void>;
    legacyCopy?: (text: string) => boolean;
    link?: () => string;
    render?: (feedback: CopyFeedback) => void;
  } = {},
) {
  const writeText = vi.fn(over.writeText ?? ((_text: string) => Promise.resolve()));
  const clipboard = 'clipboard' in over ? over.clipboard : { writeText };
  const legacy = vi.fn(over.legacyCopy ?? ((_text: string) => true));
  const link = vi.fn(over.link ?? (() => LINK));
  const render = vi.fn(over.render ?? ((_feedback: CopyFeedback) => {}));
  const copy = createCopyLink({
    link,
    clipboard: clipboard as Pick<Clipboard, 'writeText'> | undefined,
    legacyCopy: legacy,
    render,
  });
  return { copy, writeText, legacy, link, render };
}

describe('shareLink (R9.14, D15)', () => {
  it('keeps origin, path, foreign parameter and fragment; replaces the old text', () => {
    const link = shareLink(
      { text: 'Hi', style: 'grunt', pitch: -3, speed: 20, variation: 0.25 },
      { origin: 'https://mumble-speech.github.io', pathname: '/playground/', search: '?utm=x&text=old', hash: '#top' },
    );
    expect(link).toBe(
      'https://mumble-speech.github.io/playground/?text=Hi&style=grunt&pitch=-3&speed=20&variation=0.25&utm=x#top',
    );
  });

  it('path / with no fragment ends in /?text=…&variation=0', () => {
    const link = shareLink(at({ text: 'Hi', style: 'grunt' }), { origin: ORIGIN, pathname: '/', search: '', hash: '' });
    expect(link).toBe(`${ORIGIN}/?text=Hi&style=grunt&pitch=0&speed=15&variation=0`);
  });

  it('path /playground/ with no parameters gives the canonical defaults', () => {
    const link = shareLink(DEFAULT_SETTINGS, { origin: ORIGIN, pathname: '/playground/', search: '', hash: '' });
    expect(link).toBe(`${ORIGIN}/playground/?text=Hello&style=beep&pitch=0&speed=15&variation=0`);
  });

  it('emoji, separators and a line break round trip through parseSettings', () => {
    const s = at({ text: TEXT, style: 'grunt', pitch: 2, speed: 9, variation: 0.35 });
    const link = shareLink(s, { origin: ORIGIN, pathname: '/playground/', search: '', hash: '#top' });
    expect(parseSettings(new URL(link).search).settings).toEqual(s);
  });

  it('the link has no raw space, and # appears only as the fragment separator', () => {
    const s = at({ text: TEXT });
    const link = shareLink(s, { origin: ORIGIN, pathname: '/playground/', search: '', hash: '#top' });
    expect(link).not.toMatch(/ /);
    expect(link.split('#')).toHaveLength(2);
    expect(link.endsWith('#top')).toBe(true);
  });
});

describe('press: happy path (R9.14, R9.15)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls writeText once with the link, and never the legacy copy', async () => {
    const { copy, writeText, legacy } = makeCopy();
    await copy.press();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('calls writeText before the first await of press() (user gesture)', async () => {
    const { copy, writeText } = makeCopy();
    const pending = copy.press();
    expect(writeText).toHaveBeenCalledWith(LINK); // checked before awaiting anything
    await pending;
  });

  it('calls link() (which flushes the URL) before the clipboard', async () => {
    const order: string[] = [];
    const { copy } = makeCopy({
      link: () => {
        order.push('link');
        return LINK;
      },
      writeText: (_text) => {
        order.push('writeText');
        return Promise.resolve();
      },
    });
    await copy.press();
    expect(order).toEqual(['link', 'writeText']);
  });

  it('renders copied, then idle at exactly 2000 ms (1999 ms: nothing)', async () => {
    const { copy, render } = makeCopy();
    await copy.press();
    expect(render.mock.calls).toEqual([[{ kind: 'copied' }]]);
    vi.advanceTimersByTime(1999);
    expect(render).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(render.mock.calls).toEqual([[{ kind: 'copied' }], [{ kind: 'idle' }]]);
  });

  it('respects a custom revertMs only through the default (2000 ms by default)', async () => {
    const render = vi.fn();
    const copy = createCopyLink({
      link: () => LINK,
      clipboard: { writeText: () => Promise.resolve() },
      legacyCopy: () => false,
      render,
      revertMs: 500,
    });
    await copy.press();
    vi.advanceTimersByTime(499);
    expect(render).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(render).toHaveBeenLastCalledWith({ kind: 'idle' });
  });
});

describe('press: repeated presses (R9.16)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a second press at 1500 ms copies again and moves the revert to 3500 ms', async () => {
    const { copy, writeText, render } = makeCopy();
    await copy.press();
    vi.advanceTimersByTime(1500);
    await copy.press();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(render.mock.calls).toEqual([[{ kind: 'copied' }], [{ kind: 'copied' }]]);
    vi.advanceTimersByTime(500); // 2000 ms: the first timer would have fired here
    expect(render).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1499); // 3499 ms
    expect(render).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1); // 3500 ms
    expect(render).toHaveBeenCalledTimes(3);
    expect(render).toHaveBeenLastCalledWith({ kind: 'idle' });
  });

  it('out of order: only the second press outcome is rendered, one revert timer', async () => {
    const d1 = deferred();
    const d2 = deferred();
    const writes = [d1.promise, d2.promise];
    const { copy, render } = makeCopy({ writeText: () => writes.shift()! });
    const p1 = copy.press();
    const p2 = copy.press();
    d2.resolve();
    await p2;
    d1.resolve();
    await p1;
    expect(render.mock.calls).toEqual([[{ kind: 'copied' }]]);
    vi.advanceTimersByTime(2000);
    expect(render.mock.calls).toEqual([[{ kind: 'copied' }], [{ kind: 'idle' }]]);
  });

  it('a first press whose writeText rejects after the second succeeded renders neither manual nor copied again', async () => {
    const d1 = deferred();
    const d2 = deferred();
    const writes = [d1.promise, d2.promise];
    const { copy, render } = makeCopy({ writeText: () => writes.shift()! });
    const p1 = copy.press();
    const p2 = copy.press();
    d2.resolve();
    await p2;
    d1.reject(notAllowed());
    await p1;
    expect(render.mock.calls).toEqual([[{ kind: 'copied' }]]);
    vi.advanceTimersByTime(2000);
    expect(render).toHaveBeenLastCalledWith({ kind: 'idle' });
    expect(render).toHaveBeenCalledTimes(2);
  });

  // BUG: the fallback runs for a press that reset() superseded, so a stale link can reach the clipboard. Kept failing.
  it('BUG: a superseded press does not write the clipboard through the fallback', async () => {
    // Its settings were replaced by reset() while writeText was pending; if the clipboard then fails,
    // the fallback currently copies the stale link even though its outcome is discarded (R9.16, R9.17).
    const d1 = deferred();
    const { copy, legacy, render } = makeCopy({ writeText: () => d1.promise });
    const p1 = copy.press();
    copy.reset();
    d1.reject(notAllowed());
    await p1;
    expect(legacy).not.toHaveBeenCalled();
    expect(render.mock.calls).toEqual([[{ kind: 'idle' }]]);
  });
});

describe('reset() (R9.16, R9.17)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('while copied: renders idle at once and the pending timer renders nothing later', async () => {
    const { copy, render } = makeCopy();
    await copy.press();
    copy.reset();
    expect(render).toHaveBeenLastCalledWith({ kind: 'idle' });
    expect(render).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('invalidates an in-flight press: its success renders nothing after the reset', async () => {
    const d = deferred();
    const { copy, render } = makeCopy({ writeText: () => d.promise });
    const p = copy.press();
    copy.reset();
    d.resolve();
    await p;
    expect(render.mock.calls).toEqual([[{ kind: 'idle' }]]);
    vi.advanceTimersByTime(5000);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

describe('press: clipboard errors fall back to legacyCopy (R9.17)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clipboard undefined: legacyCopy is called synchronously with the link; true renders copied', async () => {
    const { copy, legacy, render } = makeCopy({ clipboard: undefined, legacyCopy: () => true });
    const pending = copy.press();
    expect(legacy).toHaveBeenCalledWith(LINK);
    await pending;
    expect(render.mock.calls).toEqual([[{ kind: 'copied' }]]);
  });

  it('writeText rejects with NotAllowedError: legacyCopy gets the same link; true renders copied', async () => {
    const { copy, legacy, render } = makeCopy({
      writeText: () => Promise.reject(notAllowed()),
      legacyCopy: () => true,
    });
    await copy.press();
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledWith(LINK);
    expect(render.mock.calls).toEqual([[{ kind: 'copied' }]]);
  });

  it('writeText throws synchronously: legacyCopy gets the same link; true renders copied', async () => {
    const { copy, legacy, render } = makeCopy({
      writeText: () => {
        throw notAllowed();
      },
      legacyCopy: () => true,
    });
    await copy.press();
    expect(legacy).toHaveBeenCalledWith(LINK);
    expect(render.mock.calls).toEqual([[{ kind: 'copied' }]]);
  });

  it('both fail: legacyCopy false renders manual with the full link, and no revert timer runs', async () => {
    const { copy, render, writeText } = makeCopy({
      writeText: () => Promise.reject(notAllowed()),
      legacyCopy: () => false,
    });
    await copy.press();
    expect(render.mock.calls).toEqual([[{ kind: 'manual', link: LINK }]]);
    vi.advanceTimersByTime(10_000);
    expect(render).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('both fail: legacyCopy throws renders manual with the full link', async () => {
    const { copy, render } = makeCopy({
      clipboard: undefined,
      legacyCopy: () => {
        throw new Error('execCommand unavailable');
      },
    });
    await copy.press();
    expect(render.mock.calls).toEqual([[{ kind: 'manual', link: LINK }]]);
    vi.advanceTimersByTime(10_000);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('after a manual outcome, reset() returns to idle and a later successful press renders copied', async () => {
    const { copy, render, writeText } = makeCopy({
      writeText: () => Promise.reject(notAllowed()),
      legacyCopy: () => false,
    });
    await copy.press();
    copy.reset();
    expect(render).toHaveBeenLastCalledWith({ kind: 'idle' });
    writeText.mockImplementation(() => Promise.resolve());
    await copy.press();
    expect(render).toHaveBeenLastCalledWith({ kind: 'copied' });
    expect(render.mock.calls.map((c) => c[0].kind)).toEqual(['manual', 'idle', 'copied']);
  });

  it('a manual outcome is not replaced by a timer, and a later manual press shows the new link', async () => {
    const link = vi.fn().mockReturnValueOnce(LINK).mockReturnValueOnce(`${LINK}&x=1`);
    const { copy, render } = makeCopy({ clipboard: undefined, legacyCopy: () => false, link });
    await copy.press();
    await copy.press();
    expect(render.mock.calls).toEqual([
      [{ kind: 'manual', link: LINK }],
      [{ kind: 'manual', link: `${LINK}&x=1` }],
    ]);
  });
});

describe('press never throws and never logs (R9.18)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const failures: [string, Parameters<typeof makeCopy>[0]][] = [
    ['clipboard undefined, legacy true', { clipboard: undefined, legacyCopy: () => true }],
    ['clipboard undefined, legacy false', { clipboard: undefined, legacyCopy: () => false }],
    ['clipboard undefined, legacy throws', { clipboard: undefined, legacyCopy: () => { throw new Error('x'); } }],
    ['writeText rejects, legacy true', { writeText: () => Promise.reject(notAllowed()), legacyCopy: () => true }],
    ['writeText rejects, legacy false', { writeText: () => Promise.reject(notAllowed()), legacyCopy: () => false }],
    ['writeText rejects, legacy throws', { writeText: () => Promise.reject(notAllowed()), legacyCopy: () => { throw new Error('x'); } }],
    ['writeText throws, legacy throws', { writeText: () => { throw notAllowed(); }, legacyCopy: () => { throw new Error('x'); } }],
    ['link throws', { link: () => { throw new Error('bad settings'); } }],
    ['render throws', { render: () => { throw new Error('view broke'); } }],
  ];

  it.each(failures)('%s: press resolves to undefined and console.error is not called', async (_name, over) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { copy } = makeCopy(over);
    await expect(copy.press()).resolves.toBeUndefined();
    vi.advanceTimersByTime(5000);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('a press that fails after a reset, and a reset with no press, never throw or log', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { copy } = makeCopy({ writeText: () => Promise.reject(notAllowed()), legacyCopy: () => false });
    expect(() => copy.reset()).not.toThrow();
    await expect(copy.press()).resolves.toBeUndefined();
    copy.reset();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('pending debounce is flushed by press (R9.2, R9.11, R9.15)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Same wiring as main.ts: link() schedules the current settings, flushes the URL, then builds the link. */
  function wire(env: ReturnType<typeof fakeBrowser>, initial: Settings) {
    let settings = initial;
    const sync = createUrlSync({ history: env.history as unknown as History, location: env.location });
    const copy = makeCopy({
      link: () => {
        sync.schedule(settings);
        sync.flush();
        return shareLink(settings, env.location);
      },
    });
    return {
      ...copy,
      history: env.history,
      change(next: Settings) {
        settings = next;
        copy.copy.reset();
        sync.schedule(next); // controls.onChange (R9.2)
      },
    };
  }

  it('schedule then press at 100 ms writes once immediately, copies the new canonical URL, and nothing follows', async () => {
    const env = fakeBrowser('/playground/?text=old#top');
    const { copy, change, writeText, history } = wire(env, DEFAULT_SETTINGS);
    change(at({ text: 'new text', style: 'grunt' }));
    vi.advanceTimersByTime(100);
    await copy.press();
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0];
    expect(copied).toBe(ORIGIN + '/playground/?text=new+text&style=grunt&pitch=0&speed=15&variation=0#top');
    expect(env.addressBar()).toBe(copied);
    vi.advanceTimersByTime(300);
    expect(history.replaceState).toHaveBeenCalledTimes(1);
  });

  it('replaceState runs before the clipboard write', async () => {
    const env = fakeBrowser('/playground/');
    const { copy, change, writeText } = wire(env, DEFAULT_SETTINGS);
    const log = env.log;
    change(at({ pitch: 4 }));
    writeText.mockImplementation((text: string) => {
      log.push(`writeText ${text}`);
      return Promise.resolve();
    });
    await copy.press();
    expect(log.map((l) => l.split(' ')[0])).toEqual(['replaceState', 'writeText']);
  });

  it('pressed before any change: the canonical defaults are copied and replaceState writes them once', async () => {
    const env = fakeBrowser('/playground/');
    const { copy, history, writeText } = wire(env, DEFAULT_SETTINGS);
    await copy.press();
    const canonical = `${ORIGIN}/playground/?text=Hello&style=beep&pitch=0&speed=15&variation=0`;
    expect(writeText).toHaveBeenCalledWith(canonical);
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/playground/?text=Hello&style=beep&pitch=0&speed=15&variation=0');
  });

  it('replaceState throwing SecurityError: the copy still happens and renders copied', async () => {
    const env = fakeBrowser('/playground/');
    const { copy, change, writeText, render, history } = wire(env, DEFAULT_SETTINGS);
    history.replaceState.mockImplementation(() => {
      throw new DOMException('Too many calls to Location or History APIs', 'SecurityError');
    });
    change(at({ text: 'still copied' }));
    render.mockClear(); // the reset() of the change rendered idle; only the press is under test
    await copy.press();
    expect(writeText).toHaveBeenCalledWith(
      `${ORIGIN}/playground/?text=still+copied&style=beep&pitch=0&speed=15&variation=0`,
    );
    expect(render.mock.calls).toEqual([[{ kind: 'copied' }]]);
  });
});

describe('press has no playback or settings side effects (R9.20)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('only link, clipboard, legacyCopy and render are called, and the settings are not mutated', async () => {
    const settings = Object.freeze(at({ text: 'Ciao 👋', style: 'alphabet', pitch: 5, speed: 22, variation: 0.5 }));
    const snapshot = { ...settings };
    const link = vi.fn(() => shareLink(settings, { origin: ORIGIN, pathname: '/playground/', search: '', hash: '' }));
    const legacy = vi.fn(() => true);
    const render = vi.fn();
    const writeText = vi.fn(() => Promise.reject(notAllowed()));
    const copy = createCopyLink({
      link,
      clipboard: { writeText },
      legacyCopy: legacy,
      render,
    });
    await copy.press();
    copy.reset();
    expect(link).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);
    expect(settings).toEqual(snapshot);
  });
});

describe('legacyCopy (R9.17, R9.19, D16)', () => {
  /** Minimal document: body.append, createElement, execCommand, activeElement, a textarea with focus/select. */
  function fakeDocument(execCommand: () => boolean) {
    type Field = {
      tag: string;
      value: string;
      readOnly: boolean;
      style: { cssText: string };
      attrs: Map<string, string>;
      selection: [number, number] | null;
      focus(): void;
      select(): void;
      setSelectionRange(start: number, end: number): void;
      setAttribute(name: string, value: string): void;
      remove(): void;
    };
    const doc = {
      body: {
        children: [] as Field[],
        append(...nodes: Field[]) {
          this.children.push(...nodes);
        },
      },
      activeElement: null as unknown,
      seen: [] as { active: unknown; readOnly: boolean; attrs: Record<string, string>; style: string; value: string; selection: [number, number] | null }[],
      createElement: vi.fn((tag: string): Field => {
        const field: Field = {
          tag,
          value: '',
          readOnly: false,
          style: { cssText: '' },
          attrs: new Map(),
          selection: null,
          focus() {
            doc.activeElement = field;
          },
          select() {
            field.selection = [0, field.value.length];
          },
          setSelectionRange(start, end) {
            field.selection = [start, end];
          },
          setAttribute(name, value) {
            field.attrs.set(name, value);
          },
          remove() {
            doc.body.children = doc.body.children.filter((n) => n !== field);
          },
        };
        return field;
      }),
      execCommand: vi.fn((command: string) => {
        expect(command).toBe('copy');
        const area = doc.body.children.at(-1)!;
        doc.seen.push({
          active: doc.activeElement,
          readOnly: area.readOnly,
          attrs: Object.fromEntries(area.attrs),
          style: area.style.cssText,
          value: area.value,
          selection: area.selection,
        });
        return execCommand();
      }),
    };
    const returnFocus = {
      focus: vi.fn(() => {
        doc.activeElement = returnFocus;
      }),
    };
    return { doc, returnFocus: returnFocus as unknown as HTMLElement };
  }

  it('returns true when execCommand returns true', () => {
    const { doc, returnFocus } = fakeDocument(() => true);
    expect(legacyCopy(LINK, doc as unknown as Document, returnFocus)).toBe(true);
  });

  it('returns false when execCommand returns false', () => {
    const { doc, returnFocus } = fakeDocument(() => false);
    expect(legacyCopy(LINK, doc as unknown as Document, returnFocus)).toBe(false);
  });

  it('the textarea is read-only, off-screen, aria-hidden, holds the link and is selected, all before execCommand', () => {
    const { doc, returnFocus } = fakeDocument(() => true);
    legacyCopy(LINK, doc as unknown as Document, returnFocus);
    const [seen] = doc.seen;
    expect(doc.createElement).toHaveBeenCalledWith('textarea');
    expect(seen.readOnly).toBe(true);
    expect(seen.attrs['aria-hidden']).toBe('true');
    expect(seen.style).toContain('position:fixed');
    expect(seen.style).toContain('left:-9999px');
    expect(seen.value).toBe(LINK);
    expect(seen.selection).toEqual([0, LINK.length]);
    expect(seen.active).toBeTruthy(); // the textarea had the focus when the copy ran
    expect(seen.active).not.toBe(returnFocus);
  });

  it.each([
    ['execCommand true', () => true, true],
    ['execCommand false', () => false, false],
  ])('%s: the textarea is removed and the focus returns to the button', (_name, exec) => {
    const { doc, returnFocus } = fakeDocument(exec);
    legacyCopy(LINK, doc as unknown as Document, returnFocus);
    expect(doc.body.children).toEqual([]);
    expect(doc.activeElement).toBe(returnFocus);
  });

  it('when execCommand throws, the textarea is still removed and the focus still returns', () => {
    const { doc, returnFocus } = fakeDocument(() => {
      throw new DOMException('not allowed', 'NotAllowedError');
    });
    try {
      legacyCopy(LINK, doc as unknown as Document, returnFocus);
    } catch {
      // execCommand's exception is allowed to propagate here; press() catches it.
    }
    expect(doc.body.children).toEqual([]);
    expect(doc.activeElement).toBe(returnFocus);
  });

  // BUG: legacyCopy lets execCommand's exception escape instead of returning false. Kept failing.
  it('BUG: legacyCopy returns false when execCommand throws (press() maps the throw to manual, but the contract is false)', () => {
    const { doc, returnFocus } = fakeDocument(() => {
      throw new DOMException('not allowed', 'NotAllowedError');
    });
    let result: unknown = 'not called';
    try {
      result = legacyCopy(LINK, doc as unknown as Document, returnFocus);
    } catch (e) {
      result = `threw ${(e as Error).name}`;
    }
    expect(result).toBe(false);
  });
});

describe('index.html markup for Copy link (R9.13, R9.16, R9.17, R9.19)', () => {
  it('#copy-link is a <button> placed after Export WAV inside .actions', () => {
    const actions = indexHtml.match(/<div class="actions">([\s\S]*?)<\/div>/)?.[1] ?? '';
    const buttons = [...actions.matchAll(/<button id="([^"]+)"/g)].map((m) => m[1]);
    expect(buttons).toEqual(['play', 'export', 'copy-link']);
    expect(indexHtml).toMatch(/<button id="copy-link" type="button">Copy link<\/button>/);
  });

  it('#copy-status has role="status" and the visually-hidden class', () => {
    const tag = indexHtml.match(/<p id="copy-status"[^>]*>/)?.[0] ?? '';
    expect(tag).toMatch(/role="status"/);
    expect(tag).toMatch(/class="[^"]*\bvisually-hidden\b/);
    // The .visually-hidden rule itself lives in style.css, which Vitest does not expose as text; not asserted here.
  });

  it('#copy-fallback is hidden by default and holds a labelled readonly #copy-url input', () => {
    const fallback = indexHtml.match(/<div id="copy-fallback"[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(fallback.match(/<div id="copy-fallback"[^>]*>/)?.[0]).toMatch(/\shidden[\s>]/);
    expect(fallback).toContain('<label for="copy-url">');
    const input = fallback.match(/<input id="copy-url"[^>]*>/)?.[0] ?? '';
    expect(input).toMatch(/type="text"/);
    expect(input).toMatch(/\sreadonly[\s/>]/);
  });
});
