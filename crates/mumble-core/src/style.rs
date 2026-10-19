//! The three styles: what each sounding grapheme plays and which dot it shows.
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum DotSize {
    Sm = 0,
    Md = 1,
    Lg = 2,
}

/// Visualization hint for a sound: color as `0xRRGGBB` (LD3) and size.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Dot {
    pub rgb: u32,
    pub size: DotSize,
}

const TEAL: u32 = 0x3f8f78;
const BLUE: u32 = 0x3f6fc4;
const OLIVE: u32 = 0x7d8f45;
const ORANGE: u32 = 0xb85a33;
const MUTED: u32 = 0x9aa0a6;

/// A style's choice for one grapheme. `variant` identifies the sound within the style (R3.3).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Choice {
    pub spec: SoundSpec,
    pub dot: Dot,
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
        Choice { spec: SPEC, dot: Dot { rgb: TEAL, size: DotSize::Md }, variant: 0 }
    }
}

pub mod grunt {
    //! A few grunts per voice, never the same twice in a row (R3.2, R3.3).
    use super::*;

    const fn g(frequency: f64, glide: f64, duration_ratio: f64, formants: [f64; 2], rgb: u32, size: DotSize) -> (SoundSpec, Dot) {
        (
            SoundSpec {
                waveform: Waveform::Sawtooth,
                frequency,
                glide,
                duration_ratio,
                formants: Some(formants),
                vocal_tract: None,
                noise_burst: None,
                gain: 0.5,
            },
            Dot { rgb, size },
        )
    }

    pub const GRUNTS: [(SoundSpec, Dot); 4] = [
        g(140.0, -3.0, 0.5, [600.0, 1000.0], TEAL, DotSize::Sm),
        g(180.0, -5.0, 0.75, [700.0, 1200.0], BLUE, DotSize::Md),
        g(110.0, -2.0, 0.9, [500.0, 900.0], OLIVE, DotSize::Lg),
        g(210.0, -6.0, 0.6, [800.0, 1400.0], ORANGE, DotSize::Md),
    ];

    pub(crate) fn choose(rng: &mut Mulberry32, prev: Option<u8>) -> Choice {
        let count = GRUNTS.len();
        let mut i = (rng.next_f64() * count as f64) as usize;
        if Some(i as u8) == prev {
            i = (i + 1 + (rng.next_f64() * (count - 1) as f64) as usize) % count;
        }
        let (spec, dot) = GRUNTS[i];
        Choice { spec, dot, variant: i as u8 }
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

    pub fn letter_dot(n: u8) -> Dot {
        let hue = libm::round(f64::from(n) * 360.0 / 26.0);
        Dot { rgb: hsl_to_rgb(hue, 0.55, 0.55), size: DotSize::Md }
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
            TokenKind::Letter(n) => Choice { spec: letter_spec(n), dot: letter_dot(n), variant: n },
            _ => Choice {
                spec: NEUTRAL_SPEC,
                dot: Dot { rgb: MUTED, size: DotSize::Md },
                variant: NEUTRAL_VARIANT,
            },
        }
    }

    fn hsl_to_rgb(hue: f64, saturation: f64, lightness: f64) -> u32 {
        let chroma = (1.0 - libm::fabs(2.0 * lightness - 1.0)) * saturation;
        let h = hue / 60.0;
        let x = chroma * (1.0 - libm::fabs(libm::fmod(h, 2.0) - 1.0));
        let (r, g, b) = match h as u32 {
            0 => (chroma, x, 0.0),
            1 => (x, chroma, 0.0),
            2 => (0.0, chroma, x),
            3 => (0.0, x, chroma),
            4 => (x, 0.0, chroma),
            _ => (chroma, 0.0, x),
        };
        let m = lightness - chroma / 2.0;
        let channel = |v: f64| libm::round((v + m) * 255.0) as u32;
        (channel(r) << 16) | (channel(g) << 8) | channel(b)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn hsl_matches_css() {
            assert_eq!(hsl_to_rgb(0.0, 0.55, 0.55), 0xcb4d4d);
            assert_eq!(hsl_to_rgb(120.0, 0.55, 0.55), 0x4dcb4d);
            assert_eq!(hsl_to_rgb(240.0, 0.55, 0.55), 0x4d4dcb);
        }
    }
}
