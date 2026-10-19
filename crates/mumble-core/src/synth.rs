//! Pure DSP for one sound (specs/design.md §6, D6). All math in f64 through `libm` (L1.4).

use crate::rng::Mulberry32;
use crate::style::{SoundSpec, Waveform};
use alloc::vec::Vec;

const ATTACK: f64 = 0.003;
const RELEASE: f64 = 0.015;
const MASTER_GAIN: f64 = 0.8;
const PEAK_LIMIT: f64 = 0.98;
const FORMANT_Q: f64 = 8.0;
/// Narrow bandpasses keep ~one harmonic each: bring the level back up (D5).
const FORMANT_MAKEUP: f64 = 3.0;
const NOISE_Q: f64 = 2.0;
/// −60 dB: where the noise burst decay ends.
const NOISE_FLOOR: f64 = 0.001;
/// Brings cascade vowels near the level of the other styles (D9).
const VOCAL_TRACT_GAIN: f64 = 0.25;

/// Samples of one sound lasting `duration` seconds. `noise` is consumed only for consonant bursts.
pub fn sound(spec: &SoundSpec, duration: f64, sample_rate: u32, noise: &mut Mulberry32) -> Vec<f32> {
    let sr = f64::from(sample_rate);
    let n = libm::round(duration * sr) as usize;
    let mut out = alloc::vec![0.0f64; n];
    if n == 0 {
        return Vec::new();
    }
    let attack = ATTACK * sr;
    let release = libm::fmin(RELEASE, duration * 0.3) * sr;
    let level = spec.gain * MASTER_GAIN;

    let mut formants = spec.formants.map(|fs| fs.map(|f| Bandpass::new(f, FORMANT_Q, sr)));
    let mut tract = spec.vocal_tract.map(|rs| rs.map(|r| Resonator::new(r.frequency, r.bandwidth, sr)));
    // Frequency follows f0 · ratio^(k/n), computed as a running product.
    let glide_step = libm::pow(libm::pow(2.0, spec.glide / 12.0), 1.0 / n as f64);
    let mut frequency = spec.frequency;
    let mut phase = 0.0;

    for (k, sample) in out.iter_mut().enumerate() {
        let dt = frequency / sr;
        let mut x = oscillator(spec.waveform, phase, dt);
        phase += dt;
        if phase >= 1.0 {
            phase -= 1.0;
        }
        frequency *= glide_step;
        if let Some(filters) = formants.as_mut() {
            x = filters.iter_mut().map(|f| f.process(x)).sum::<f64>() * FORMANT_MAKEUP;
        }
        if let Some(resonators) = tract.as_mut() {
            for r in resonators.iter_mut() {
                x = r.process(x);
            }
            x *= VOCAL_TRACT_GAIN;
        }
        let k = k as f64;
        let env = if k < attack {
            k / attack
        } else if k > n as f64 - release {
            (n as f64 - k) / release
        } else {
            1.0
        };
        *sample = x * env * level;
    }

    if let Some(burst) = spec.noise_burst {
        let m = (libm::round(burst.duration_ms / 1000.0 * sr) as usize).min(n);
        let mut filter = Bandpass::new(burst.center_hz, NOISE_Q, sr);
        let decay_step = libm::pow(NOISE_FLOOR, 1.0 / m as f64);
        let mut decay = 1.0;
        for sample in out.iter_mut().take(m) {
            *sample += filter.process(noise.next_f64() * 2.0 - 1.0) * decay * level;
            decay *= decay_step;
        }
    }

    // Each sound is limited on its own, so render and Speaker match exactly (R5.5, LD2).
    let peak = out.iter().fold(0.0f64, |m, x| libm::fmax(m, libm::fabs(*x)));
    let scale = if peak > PEAK_LIMIT { PEAK_LIMIT / peak } else { 1.0 };
    out.into_iter().map(|x| (x * scale) as f32).collect()
}

/// One sample at `phase` ∈ [0, 1). `dt` is the phase increment, used by PolyBLEP.
fn oscillator(waveform: Waveform, phase: f64, dt: f64) -> f64 {
    match waveform {
        Waveform::Sine => libm::sin(2.0 * core::f64::consts::PI * phase),
        Waveform::Triangle => 4.0 * libm::fabs(phase - 0.5) - 1.0,
        Waveform::Sawtooth => 2.0 * phase - 1.0 - poly_blep(phase, dt),
        Waveform::Square => {
            let naive = if phase < 0.5 { 1.0 } else { -1.0 };
            naive + poly_blep(phase, dt) - poly_blep(libm::fmod(phase + 0.5, 1.0), dt)
        }
    }
}

/// Smooths the discontinuity of naive waveforms to reduce aliasing.
fn poly_blep(t: f64, dt: f64) -> f64 {
    if t < dt {
        let t = t / dt;
        t + t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + t + t + 1.0
    } else {
        0.0
    }
}

/// RBJ cookbook bandpass, 0 dB peak gain, transposed direct form II.
struct Bandpass {
    b0: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Bandpass {
    fn new(frequency: f64, q: f64, sr: f64) -> Bandpass {
        let w0 = 2.0 * core::f64::consts::PI * frequency / sr;
        let alpha = libm::sin(w0) / (2.0 * q);
        let a0 = 1.0 + alpha;
        Bandpass {
            b0: alpha / a0,
            b2: -alpha / a0,
            a1: -2.0 * libm::cos(w0) / a0,
            a2: (1.0 - alpha) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = -self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

/// Klatt resonator, unity gain at DC. Chained in cascade they shape a vowel.
struct Resonator {
    a: f64,
    b: f64,
    c: f64,
    y1: f64,
    y2: f64,
}

impl Resonator {
    fn new(frequency: f64, bandwidth: f64, sr: f64) -> Resonator {
        let c = -libm::exp(-2.0 * core::f64::consts::PI * bandwidth / sr);
        let b = 2.0 * libm::exp(-core::f64::consts::PI * bandwidth / sr)
            * libm::cos(2.0 * core::f64::consts::PI * frequency / sr);
        Resonator { a: 1.0 - b - c, b, c, y1: 0.0, y2: 0.0 }
    }

    fn process(&mut self, x: f64) -> f64 {
        let y = self.a * x + self.b * self.y1 + self.c * self.y2;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}
