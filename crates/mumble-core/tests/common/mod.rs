//! Shared helpers for the integration tests.
//!
//! Port of the original TypeScript suite (playground repo, `tests/`), task B5:
//!
//! | TypeScript test file      | Rust counterpart                                              |
//! |---------------------------|---------------------------------------------------------------|
//! | tokenize.test.ts          | `src/text.rs` unit tests (normalize, classify, is_audible)    |
//! | rng.test.ts               | `src/rng.rs` unit tests (same pinned mulberry32 values)       |
//! | timeline.test.ts          | `tests/behavior.rs` (slots, pauses, overlap, voice, determinism) |
//! | styles.test.ts            | `tests/behavior.rs` (beep, grunt, alphabet, R3.9, R3.10)      |
//! | synth.test.ts             | `tests/audio.rs` (length, silence, frequency, glide, peak, vowels, perf) |
//! | audio.test.ts › encodeWav | `src/wav.rs` unit tests                                       |
//!
//! Not ported, because they stay in the playground: exportFilename, the buffer cache and
//! eventAt (UI concerns). Snapshot tests become conformance vectors (task C1).
//! Math.random checks have no Rust equivalent: the core has no access to any other RNG.

#![allow(dead_code)]

use mumble_speech::internals::Mulberry32;
use mumble_speech::{StyleId, Voice};

pub const SR: u32 = 44_100;

pub fn voice(style: StyleId) -> Voice {
    Voice::new(style)
}

/// Deterministic random texts mixing letters, accents, digits, spaces and punctuation.
pub fn random_texts(count: usize) -> Vec<String> {
    const CHARSET: &[&str] = &[
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u",
        "v", "w", "x", "y", "z", "A", "B", "C", "à", "è", "0", "1", "9", " ", " ", " ", ",", ".", "!", "?", "#",
        "👋",
    ];
    let mut rng = Mulberry32::new(1234);
    (0..count)
        .map(|_| {
            let len = 1 + (rng.next_f64() * 120.0) as usize;
            (0..len).map(|_| CHARSET[(rng.next_f64() * CHARSET.len() as f64) as usize]).collect()
        })
        .collect()
}

pub fn rms(data: &[f32]) -> f64 {
    (data.iter().map(|x| f64::from(*x).powi(2)).sum::<f64>() / data.len() as f64).sqrt()
}

pub fn slice(data: &[f32], from: f64, to: f64) -> &[f32] {
    &data[(from * f64::from(SR)).round() as usize..(to * f64::from(SR)).round() as usize]
}

pub fn semitones(frequency: f64, base: f64) -> f64 {
    12.0 * (frequency / base).log2()
}
