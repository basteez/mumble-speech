import { fnv1a, mulberry32 } from '../core/rng.ts';
import type { Rng, SoundEvent, Timeline, Waveform } from '../core/types.ts';

// Pure DSP: Timeline → samples, used for both playback and export. See specs/design.md §6.1 (D1, D6).

export const SAMPLE_RATE = 44100;

const ATTACK = 0.003;
const RELEASE = 0.015;
const MASTER_GAIN = 0.8;
const PEAK_LIMIT = 0.98;
const FORMANT_Q = 8;
/** Narrow bandpasses keep ~one harmonic each: bring the level back up (D5). */
const FORMANT_MAKEUP = 3;
const NOISE_Q = 2;
/** Brings cascade vowels near the level of the other styles (D9). Calibrated, see tests. */
const VOCAL_TRACT_GAIN = 0.25;
/** −60 dB: where the noise burst decay ends. */
const NOISE_FLOOR = 0.001;

export function synthesize(timeline: Timeline, sampleRate = SAMPLE_RATE): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.ceil(timeline.duration * sampleRate));
  const noise = mulberry32(fnv1a('noise'));
  for (const event of timeline.events) renderEvent(out, event, sampleRate, noise);
  limitPeak(out);
  return out;
}

function renderEvent(out: Float32Array, event: SoundEvent, sr: number, noise: Rng) {
  const { sound } = event;
  const offset = Math.round(event.start * sr);
  const n = Math.min(Math.round(event.duration * sr), out.length - offset);
  const attack = ATTACK * sr;
  const release = Math.min(RELEASE, event.duration * 0.3) * sr;
  const glideRatio = 2 ** ((sound.glide ?? 0) / 12);
  const filters = sound.formants?.map((f) => bandpass(f, FORMANT_Q, sr));
  const tract = sound.vocalTract?.map((r) => resonator(r.frequency, r.bandwidth, sr));
  const level = sound.gain * MASTER_GAIN;

  let phase = 0;
  for (let k = 0; k < n; k++) {
    const dt = (sound.frequency * glideRatio ** (k / n)) / sr;
    let x = oscillator(sound.waveform, phase, dt);
    phase += dt;
    if (phase >= 1) phase -= 1;
    if (filters) {
      let sum = 0;
      for (const filter of filters) sum += filter(x);
      x = sum * FORMANT_MAKEUP;
    }
    if (tract) {
      for (const r of tract) x = r(x);
      x *= VOCAL_TRACT_GAIN;
    }
    const env = k < attack ? k / attack : k > n - release ? (n - k) / release : 1;
    out[offset + k] += x * env * level;
  }

  if (sound.noiseBurst) {
    const m = Math.min(n, Math.round((sound.noiseBurst.durationMs / 1000) * sr));
    const filter = bandpass(sound.noiseBurst.centerHz, NOISE_Q, sr);
    for (let k = 0; k < m; k++) {
      const decay = NOISE_FLOOR ** (k / m);
      out[offset + k] += filter(noise() * 2 - 1) * decay * level;
    }
  }
}

/** One sample at `phase` ∈ [0, 1). `dt` is the phase increment, used by PolyBLEP. */
function oscillator(waveform: Waveform, phase: number, dt: number): number {
  switch (waveform) {
    case 'sine':
      return Math.sin(2 * Math.PI * phase);
    case 'triangle':
      return 4 * Math.abs(phase - 0.5) - 1;
    case 'sawtooth':
      return 2 * phase - 1 - polyBlep(phase, dt);
    case 'square':
      return (phase < 0.5 ? 1 : -1) + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1, dt);
  }
}

/** Smooths the discontinuity of naive waveforms to reduce aliasing. */
function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** RBJ cookbook bandpass, 0 dB peak gain, transposed direct form II. */
function bandpass(frequency: number, q: number, sr: number): (x: number) => number {
  const w0 = (2 * Math.PI * frequency) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  let z1 = 0;
  let z2 = 0;
  return (x) => {
    const y = b0 * x + z1;
    z1 = -a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

/** Klatt resonator, unity gain at DC. Chained in cascade they shape a vowel. */
function resonator(frequency: number, bandwidth: number, sr: number): (x: number) => number {
  const c = -Math.exp((-2 * Math.PI * bandwidth) / sr);
  const b = 2 * Math.exp((-Math.PI * bandwidth) / sr) * Math.cos((2 * Math.PI * frequency) / sr);
  const a = 1 - b - c;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = a * x + b * y1 + c * y2;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/** Scales the whole buffer down if it peaks above PEAK_LIMIT (R5.5). */
function limitPeak(data: Float32Array) {
  let peak = 0;
  for (const x of data) peak = Math.max(peak, Math.abs(x));
  if (peak > PEAK_LIMIT) {
    const k = PEAK_LIMIT / peak;
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
}
