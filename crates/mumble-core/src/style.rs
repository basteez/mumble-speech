//! The three styles: what each sounding grapheme plays and which variant it is.
//! Tables and formulas: specs/design.md §5.

use crate::rng::Mulberry32;
use crate::text::TokenKind;
use crate::voice::StyleId;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Waveform {
    Square,
    Sawtooth,
    Triangle,
    Sine,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Resonance {
    /// Hz.
    pub frequency: f64,
    /// Hz.
    pub bandwidth: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NoiseBurst {
    pub center_hz: f64,
    pub duration_ms: f64,
}

/// What to play, independent of any audio API.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SoundSpec {
    pub waveform: Waveform,
    /// Hz. Before pitch/variation in a style, after them in an [`crate::Event`].
    pub frequency: f64,
    /// Semitones of glide over the whole duration; 0 for none.
    pub glide: f64,
    /// Fraction of the slot, (0, 0.9].
    pub duration_ratio: f64,
    /// Hz, parallel bandpass filters (grunt timbre).
    pub formants: Option<[f64; 2]>,
    /// Cascade resonators (vowels, R3.9).
    pub vocal_tract: Option<[Resonance; 3]>,
    /// Consonant attack.
    pub noise_burst: Option<NoiseBurst>,
    /// 0..1.
    pub gain: f64,
}

/// Which sound of the style an event plays (L2.3, LD14): beep 0; grunt 0–3;
/// alphabet 0–25 for `a`–`z`, 26 for the neutral sound. Neutral data: hosts map it to
/// whatever they like (mouth shapes, particles, colors).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct SoundId {
    pub style: StyleId,
    pub variant: u8,
}

/// A style's choice for one grapheme. `variant` identifies the sound within the style (R3.3).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Choice {
    pub spec: SoundSpec,
    pub variant: u8,
}

pub(crate) fn choose(style: StyleId, kind: TokenKind, rng: &mut Mulberry32, prev: Option<u8>) -> Choice {
    match style {
        StyleId::Beep => beep::choose(),
        StyleId::Grunt => grunt::choose(rng, prev),
        StyleId::Alphabet => alphabet::choose(kind),
    }
}

mod beep {
    use super::*;

    const SPEC: SoundSpec = SoundSpec {
        waveform: Waveform::Square,
        frequency: 520.0,
        glide: 0.0,
        duration_ratio: 0.5,
        formants: None,
        vocal_tract: None,
        noise_burst: None,
        gain: 0.35,
    };

    /// One beep for every letter (R3.1).
    pub(crate) fn choose() -> Choice {
        Choice { spec: SPEC, variant: 0 }
    }
}

pub mod grunt {
    //! A few grunts per voice, never the same twice in a row (R3.2, R3.3).
    use super::*;

    const fn g(frequency: f64, glide: f64, duration_ratio: f64, formants: [f64; 2]) -> SoundSpec {
        SoundSpec {
            waveform: Waveform::Sawtooth,
            frequency,
            glide,
            duration_ratio,
            formants: Some(formants),
            vocal_tract: None,
            noise_burst: None,
            gain: 0.5,
        }
    }

    /// Indexed by variant.
    pub const GRUNTS: [SoundSpec; 4] = [
        g(140.0, -3.0, 0.5, [600.0, 1000.0]),
        g(180.0, -5.0, 0.75, [700.0, 1200.0]),
        g(110.0, -2.0, 0.9, [500.0, 900.0]),
        g(210.0, -6.0, 0.6, [800.0, 1400.0]),
    ];

    pub(crate) fn choose(rng: &mut Mulberry32, prev: Option<u8>) -> Choice {
        let count = GRUNTS.len();
        let mut i = (rng.next_f64() * count as f64) as usize;
        if Some(i as u8) == prev {
            i = (i + 1 + (rng.next_f64() * (count - 1) as f64) as usize) % count;
        }
        Choice { spec: GRUNTS[i], variant: i as u8 }
    }
}

pub mod alphabet {
    //! A sound for every letter: Italian vowels through a cascade vocal tract (R3.4, R3.5, R3.9, R3.10).
    use super::*;

    const fn r(frequency: f64, bandwidth: f64) -> Resonance {
        Resonance { frequency, bandwidth }
    }

    /// Italian vowel formants F1–F3 for a mid-high voice, in the order a e i o u.
    pub const VOWELS: [[Resonance; 3]; 5] = [
        [r(850.0, 90.0), r(1400.0, 110.0), r(2800.0, 170.0)],
        [r(450.0, 80.0), r(2200.0, 110.0), r(2900.0, 170.0)],
        [r(310.0, 70.0), r(2600.0, 120.0), r(3300.0, 200.0)],
        [r(500.0, 80.0), r(900.0, 100.0), r(2800.0, 170.0)],
        [r(340.0, 70.0), r(800.0, 100.0), r(2700.0, 170.0)],
    ];
    const SCHWA: [Resonance; 3] = [r(550.0, 90.0), r(1550.0, 110.0), r(2650.0, 170.0)];
    const A: usize = 0;
    const E: usize = 1;
    const I: usize = 2;
    const O: usize = 3;
    const U: usize = 4;

    /// Vowel of each letter a–z: vowels play themselves, consonants the vowel of their English name (D4, D9).
    pub const VOWEL_OF: [usize; 26] = [
        A, I, I, I, E, E, I, E, I, E, E, E, E, // a b c d e f g h i j k l m
        E, O, I, U, A, E, I, U, I, U, E, A, I, // n o p q r s t u v w x y z
    ];

    const BASE_HZ: f64 = 240.0;
    /// Speech-like pitch fall inside each syllable.
    const GLIDE: f64 = -1.5;
    const DURATION_RATIO: f64 = 0.85;
    const GAIN: f64 = 0.4;
    pub const NEUTRAL_VARIANT: u8 = 26;

    const fn is_vowel(n: u8) -> bool {
        matches!(n, 0 | 4 | 8 | 14 | 20)
    }

    /// Pitch offset in semitones, within ±1 (R3.10).
    pub fn offset(n: u8) -> f64 {
        f64::from((u32::from(n) * 7) % 5) * 0.5 - 1.0
    }

    pub fn letter_spec(n: u8) -> SoundSpec {
        SoundSpec {
            waveform: Waveform::Sawtooth,
            frequency: BASE_HZ * libm::pow(2.0, offset(n) / 12.0),
            glide: GLIDE,
            duration_ratio: DURATION_RATIO,
            formants: None,
            vocal_tract: Some(VOWELS[VOWEL_OF[usize::from(n)]]),
            noise_burst: (!is_vowel(n))
                .then(|| NoiseBurst { center_hz: 1500.0 + f64::from(n) * 250.0, duration_ms: 12.0 }),
            gain: GAIN,
        }
    }

    /// Schwa shared by digits and other characters (R3.5).
    pub const NEUTRAL_SPEC: SoundSpec = SoundSpec {
        waveform: Waveform::Sawtooth,
        frequency: BASE_HZ,
        glide: GLIDE,
        duration_ratio: DURATION_RATIO,
        formants: None,
        vocal_tract: Some(SCHWA),
        noise_burst: None,
        gain: GAIN,
    };

    pub(crate) fn choose(kind: TokenKind) -> Choice {
        match kind {
            TokenKind::Letter(n) => Choice { spec: letter_spec(n), variant: n },
            _ => Choice { spec: NEUTRAL_SPEC, variant: NEUTRAL_VARIANT },
        }
    }
}

