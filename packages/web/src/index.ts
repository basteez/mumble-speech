// @mumble-speech/web: typed wrapper around the WebAssembly core (specs/design.md §9.1).

import initWasm, * as wasm from './generated/mumble.js';
import { WASM_BASE64 } from './generated/wasm-inline.js';

export { WebAudioPlayer } from './player.js';

export type StyleId = 'beep' | 'grunt' | 'alphabet';

export interface Voice {
  style: StyleId;
  /** Semitones, −12..12. Default 0. */
  pitch?: number;
  /** Characters per second, 5..30. Default 15. */
  speed?: number;
  /** Random pitch deviation, 0..1. Default 0. */
  variation?: number;
  /** Random seed, unsigned 32-bit. Default 0. */
  seed?: number;
}

export type DotSize = 'sm' | 'md' | 'lg';

/** Visualization hint for a sound. */
export interface Dot {
  /** `#rrggbb`. */
  color: string;
  size: DotSize;
}

export interface MumbleEvent {
  graphemeIndex: number;
  utf8Start: number;
  utf8Length: number;
  /** UTF-16 offsets: index JavaScript strings with these. */
  utf16Start: number;
  utf16Length: number;
  /** Seconds from the start of the line. */
  start: number;
  /** Seconds. */
  duration: number;
  dot: Dot;
}

export interface Timeline {
  events: MumbleEvent[];
  /** End of the last sound plus a short tail, in seconds; 0 when nothing sounds. */
  duration: number;
}

/** Samples copied out of WebAssembly memory: always backed by a plain `ArrayBuffer`. */
export type Samples = Float32Array<ArrayBuffer>;

export interface Render {
  /** Mono samples. */
  samples: Samples;
  sampleRate: number;
  timeline: Timeline;
}

export interface Utterance {
  /** Mono samples, empty for spaces and pauses. */
  samples: Samples;
  /** Seconds to wait before the next character. */
  advance: number;
  dot: Dot | null;
}

export type MumbleErrorCode =
  | 'PitchOutOfRange'
  | 'SpeedOutOfRange'
  | 'VariationOutOfRange'
  | 'SampleRateOutOfRange'
  | 'UnknownStyle';

export class MumbleError extends Error {
  constructor(readonly code: MumbleErrorCode) {
    super(code);
    this.name = 'MumbleError';
  }
}

export const DEFAULT_SAMPLE_RATE = 48_000;

const STYLE_INDEX: Record<StyleId, number> = { beep: 0, grunt: 1, alphabet: 2 };
const SIZES: readonly DotSize[] = ['sm', 'md', 'lg'];
/** Numbers per event in the packed array (crates/mumble-wasm). */
const EVENT_STRIDE = 9;

let ready: Promise<void> | null = null;
let initialized = false;

/** Instantiates the WebAssembly module. Idempotent; every other call throws before it resolves. */
export function init(): Promise<void> {
  ready ??= (async () => {
    const binary = atob(WASM_BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    await initWasm({ module_or_path: bytes });
    initialized = true;
  })();
  return ready;
}

function call<T>(fn: () => T): T {
  if (!initialized) throw new Error('@mumble-speech/web: await init() before using the library');
  try {
    return fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message in ERROR_CODES) throw new MumbleError(message as MumbleErrorCode);
    throw e;
  }
}

const ERROR_CODES: Record<MumbleErrorCode, true> = {
  PitchOutOfRange: true,
  SpeedOutOfRange: true,
  VariationOutOfRange: true,
  SampleRateOutOfRange: true,
  UnknownStyle: true,
};

function args(voice: Voice): [number, number, number, number, number] {
  const style = STYLE_INDEX[voice.style];
  if (style === undefined) throw new MumbleError('UnknownStyle');
  return [style, voice.pitch ?? 0, voice.speed ?? 15, voice.variation ?? 0, voice.seed ?? 0];
}

function dot(rgb: number, size: number): Dot {
  return { color: `#${rgb.toString(16).padStart(6, '0')}`, size: SIZES[size] };
}

function unpack(packed: Float64Array, duration: number): Timeline {
  const events: MumbleEvent[] = [];
  for (let i = 0; i < packed.length; i += EVENT_STRIDE) {
    events.push({
      graphemeIndex: packed[i],
      utf8Start: packed[i + 1],
      utf8Length: packed[i + 2],
      utf16Start: packed[i + 3],
      utf16Length: packed[i + 4],
      start: packed[i + 5],
      duration: packed[i + 6],
      dot: dot(packed[i + 7], packed[i + 8]),
    });
  }
  return { events, duration };
}

/** Audio and events of a whole line (L2.1). */
export function render(text: string, voice: Voice, sampleRate = DEFAULT_SAMPLE_RATE): Render {
  return call(() => {
    const result = wasm.render(text, ...args(voice), sampleRate);
    try {
      const samples = result.takeSamples() as Samples;
      return { samples, sampleRate, timeline: unpack(result.takeEvents(), result.duration) };
    } finally {
      result.free();
    }
  });
}

/** The events of a line, without synthesizing audio (L2.2). */
export function timeline(text: string, voice: Voice): Timeline {
  return call(() => {
    const result = wasm.timeline(text, ...args(voice));
    try {
      return unpack(result.takeEvents(), result.duration);
    } finally {
      result.free();
    }
  });
}

/** 16-bit PCM mono WAV file (L2.4). */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  return call(() => wasm.encodeWav(samples, sampleRate) as Uint8Array<ArrayBuffer>);
}

/**
 * Produces mumble speech one character at a time, for typewriter dialogue (L3).
 * Call `free()` when done: it owns WebAssembly memory.
 */
export class Speaker {
  readonly #inner: wasm.Speaker;

  constructor(voice: Voice, readonly sampleRate = DEFAULT_SAMPLE_RATE) {
    this.#inner = call(() => new wasm.Speaker(...args(voice), sampleRate));
  }

  /** The sound of `text`, usually one character; several are played in order. */
  next(text: string): Utterance {
    return call(() => {
      const u = this.#inner.next(text);
      try {
        return { samples: u.takeSamples() as Samples, advance: u.advance, dot: u.dotRgb < 0 ? null : dot(u.dotRgb, u.dotSize) };
      } finally {
        u.free();
      }
    });
  }

  /** Back to the initial state. */
  reset(): void {
    call(() => this.#inner.reset());
  }

  free(): void {
    this.#inner.free();
  }
}
