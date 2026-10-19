use crate::rng::{fnv1a, Mulberry32};
use crate::style::{choose, Dot, SoundSpec};
use crate::synth;
use crate::text::{classify, TokenKind};
use crate::voice::{validate_sample_rate, Error, Voice};
use alloc::vec::Vec;
use unicode_segmentation::UnicodeSegmentation;

/// The sound of one or more graphemes from [`Speaker::next`] (L3.1).
#[derive(Clone, Debug, PartialEq)]
pub struct Utterance {
    /// Mono samples starting at the beginning of the first grapheme. Empty for spaces and pauses.
    pub samples: Vec<f32>,
    /// Seconds to wait before the next grapheme.
    pub advance: f64,
    /// Dot of the first sounding grapheme, `None` if nothing sounded.
    pub dot: Option<Dot>,
}

/// A sound planned for one grapheme, before synthesis.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Planned {
    /// Frequency already transposed and varied.
    pub spec: SoundSpec,
    pub dot: Dot,
    pub duration: f64,
}

/// Produces mumble speech one character at a time, for typewriter dialogue (L3).
///
/// Placing each [`Utterance`] at the cumulative sum of the previous advances gives
/// exactly the samples of [`crate::render`] for the same text (L3.2).
#[derive(Clone, Debug)]
pub struct Speaker {
    voice: Voice,
    sample_rate: u32,
    rng: Mulberry32,
    noise: Mulberry32,
    prev_variant: Option<u8>,
}

impl Speaker {
    pub fn new(voice: Voice, sample_rate: u32) -> Result<Speaker, Error> {
        voice.validate()?;
        validate_sample_rate(sample_rate)?;
        Ok(Speaker::unchecked(voice, sample_rate))
    }

    pub(crate) fn unchecked(voice: Voice, sample_rate: u32) -> Speaker {
        Speaker {
            voice,
            sample_rate,
            rng: Mulberry32::new(fnv1a(voice.style.name().as_bytes()) ^ voice.seed),
            noise: Mulberry32::new(fnv1a(b"noise")),
            prev_variant: None,
        }
    }

    pub fn voice(&self) -> Voice {
        self.voice
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Back to the initial state, as if just created (L3.4).
    pub fn reset(&mut self) {
        *self = Speaker::unchecked(self.voice, self.sample_rate);
    }

    /// The sound of `text`, usually one grapheme. Several graphemes are played in order (L3.3).
    pub fn next(&mut self, text: &str) -> Utterance {
        let sr = f64::from(self.sample_rate);
        let mut samples: Vec<f32> = Vec::new();
        let mut dot = None;
        let mut t = 0.0;
        for grapheme in text.graphemes(true) {
            let (planned, advance) = self.plan(classify(grapheme));
            if let Some(p) = planned {
                let sound = self.synthesize(&p);
                let offset = libm::round(t * sr) as usize;
                if samples.len() < offset + sound.len() {
                    samples.resize(offset + sound.len(), 0.0);
                }
                samples[offset..offset + sound.len()].copy_from_slice(&sound);
                dot.get_or_insert(p.dot);
            }
            t += advance;
        }
        Utterance { samples, advance: t, dot }
    }

    /// Chooses the sound of one grapheme and advances the random state. Returns it with the advance.
    pub(crate) fn plan(&mut self, kind: TokenKind) -> (Option<Planned>, f64) {
        let slot = 1.0 / self.voice.speed;
        let advance = f64::from(kind.slots()) * slot;
        if !kind.is_audible() {
            return (None, advance);
        }
        let choice = choose(self.voice.style, kind, &mut self.rng, self.prev_variant);
        // Always consumed, so the style's random sequence does not depend on the variation.
        let jitter = self.rng.next_f64() * 2.0 - 1.0;
        let semitones = self.voice.pitch + jitter * self.voice.variation * 2.0;
        let spec = SoundSpec { frequency: choice.spec.frequency * libm::pow(2.0, semitones / 12.0), ..choice.spec };
        self.prev_variant = Some(choice.variant);
        (Some(Planned { spec, dot: choice.dot, duration: spec.duration_ratio * slot }), advance)
    }

    pub(crate) fn synthesize(&mut self, planned: &Planned) -> Vec<f32> {
        synth::sound(&planned.spec, planned.duration, self.sample_rate, &mut self.noise)
    }
}
