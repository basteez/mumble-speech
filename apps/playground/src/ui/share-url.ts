import type { StyleId } from '@mumble-speech/web';

/** Everything that determines the sound in the playground (R9). */
export interface Settings {
  text: string;
  style: StyleId;
  pitch: number;
  speed: number;
  variation: number;
}

export type SliderKey = 'pitch' | 'speed' | 'variation';

/** Text limit in UTF-16 code units (R1.2). */
export const MAX_TEXT_LENGTH = 500;

/** Slider limits and steps, shared by the controls and the URL parser (R4.1, R9.5). */
export const SLIDER_LIMITS: Record<SliderKey, { min: number; max: number; step: number }> = {
  pitch: { min: -12, max: 12, step: 1 },
  speed: { min: 5, max: 30, step: 1 },
  variation: { min: 0, max: 1, step: 0.05 },
};

/** R1.1, R2.2, R4.1. */
export const DEFAULT_SETTINGS: Settings = { text: 'Hello', style: 'beep', pitch: 0, speed: 15, variation: 0 };

const STYLES: readonly StyleId[] = ['beep', 'grunt', 'alphabet'];
const OWNED_KEYS = ['text', 'style', 'pitch', 'speed', 'variation'] as const;
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

function parseNumber(raw: string | null, key: SliderKey): number {
  if (raw === null || !PLAIN_DECIMAL.test(raw)) return DEFAULT_SETTINGS[key];
  const { min, max, step } = SLIDER_LIMITS[key];
  const clamped = Math.min(max, Math.max(min, Number(raw)));
  // Dividing by the step and multiplying back leaves floating-point residue for 0.05.
  const snapped = key === 'variation' ? Math.round(clamped * 20) / 20 : Math.round(clamped / step) * step;
  return snapped + 0; // -0 -> 0
}

function parseText(raw: string | null): string {
  if (raw === null) return DEFAULT_SETTINGS.text;
  let text = raw.replace(/\r\n?/g, '\n');
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH);
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
  }
  return text;
}

/** `present` = at least one settings parameter in `search` (R9.4). */
export function parseSettings(search: string): { settings: Settings; present: boolean } {
  const params = new URLSearchParams(search);
  const style = params.get('style');
  return {
    present: OWNED_KEYS.some((key) => params.has(key)),
    settings: {
      text: parseText(params.get('text')),
      style: STYLES.find((id) => id === style) ?? DEFAULT_SETTINGS.style,
      pitch: parseNumber(params.get('pitch'), 'pitch'),
      speed: parseNumber(params.get('speed'), 'speed'),
      variation: parseNumber(params.get('variation'), 'variation'),
    },
  };
}

/**
 * Canonical query string (with leading `?`) for `settings`, keeping the
 * parameters of `search` that the playground does not own (R9.3, R9.10).
 */
export function serializeSettings(settings: Settings, search: string): string {
  const params = new URLSearchParams();
  for (const key of OWNED_KEYS) params.append(key, String(settings[key]));
  for (const [key, value] of new URLSearchParams(search)) {
    if (!(OWNED_KEYS as readonly string[]).includes(key)) params.append(key, value);
  }
  return `?${params}`;
}

/** Debounced `history.replaceState` (R9.2, R9.11). */
export function createUrlSync(deps: {
  history: Pick<History, 'replaceState' | 'state'>;
  location: Pick<Location, 'pathname' | 'search' | 'hash'>;
  delayMs?: number;
}) {
  const { history, location, delayMs = 250 } = deps;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Settings | undefined;

  function write() {
    timer = undefined;
    if (!pending) return;
    const settings = pending;
    const query = serializeSettings(settings, location.search);
    if (query === location.search) {
      pending = undefined;
      return;
    }
    try {
      history.replaceState(history.state, '', location.pathname + query + location.hash);
      pending = undefined;
    } catch {
      // SecurityError from the browser's History API rate limit: the next schedule retries (R9.11).
    }
  }

  return {
    /** Restarts the timer; the last settings win. */
    schedule(settings: Settings) {
      pending = settings;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(write, delayMs);
    },
    /** Writes the pending settings now (R9.4). */
    flush() {
      if (timer !== undefined) clearTimeout(timer);
      write();
    },
  };
}
