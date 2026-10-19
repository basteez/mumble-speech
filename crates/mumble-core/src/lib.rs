//! Video-game mumble speech synthesis.
//!
//! Three styles (specs/requirements.md §3):
//! - [`StyleId::Beep`]: the same beep for every character (Undertale);
//! - [`StyleId::Grunt`]: a few grunts per voice, never the same twice in a row (Banjo-Kazooie);
//! - [`StyleId::Alphabet`]: a vowel-based sound for every letter (Animal Crossing).
//!
//! Two ways to use it:
//! - [`render`] a whole line into samples plus its [`Timeline`];
//! - drive a [`Speaker`] one character at a time, typewriter style.
//!
//! Output is bit-identical across platforms and WebAssembly for the same input (L1.4).

#![no_std]

extern crate alloc;

mod render;
mod rng;
mod speaker;
mod style;
mod synth;
mod text;
mod voice;
mod wav;

pub use render::{render, timeline, Event, Render, Timeline, TAIL_SECONDS};
pub use speaker::{Speaker, Utterance};
pub use style::{Dot, DotSize};
pub use text::TokenKind;
pub use voice::{
    Error, StyleId, Voice, DEFAULT_SAMPLE_RATE, MAX_SAMPLE_RATE, MIN_SAMPLE_RATE, PITCH_RANGE, SPEED_RANGE,
    VARIATION_RANGE,
};
pub use wav::encode_wav;

#[doc(hidden)]
pub mod internals {
    //! Exposed for tests and the conformance generator only. Not part of the stable API.
    pub use crate::rng::{fnv1a, Mulberry32};
    pub use crate::style::{alphabet, grunt, NoiseBurst, Resonance, SoundSpec, Waveform};
    pub use crate::text::{classify, normalize};
    pub use crate::synth::sound;
}
