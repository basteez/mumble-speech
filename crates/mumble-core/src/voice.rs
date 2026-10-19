use core::fmt;
use core::ops::RangeInclusive;

/// Semitones (L1.7).
pub const PITCH_RANGE: RangeInclusive<f64> = -12.0..=12.0;
/// Characters per second (L1.7).
pub const SPEED_RANGE: RangeInclusive<f64> = 5.0..=30.0;
/// Random pitch deviation amount (L1.7).
pub const VARIATION_RANGE: RangeInclusive<f64> = 0.0..=1.0;

/// Default output rate, Hz (L1.5, LD4).
pub const DEFAULT_SAMPLE_RATE: u32 = 48_000;
pub const MIN_SAMPLE_RATE: u32 = 8_000;
pub const MAX_SAMPLE_RATE: u32 = 192_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum StyleId {
    Beep = 0,
    Grunt = 1,
    Alphabet = 2,
}

impl StyleId {
    pub const ALL: [StyleId; 3] = [StyleId::Beep, StyleId::Grunt, StyleId::Alphabet];

    /// Stable lowercase name, also used to derive the random seed (LD1).
    pub const fn name(self) -> &'static str {
        match self {
            StyleId::Beep => "beep",
            StyleId::Grunt => "grunt",
            StyleId::Alphabet => "alphabet",
        }
    }

    pub const fn from_u32(value: u32) -> Option<StyleId> {
        match value {
            0 => Some(StyleId::Beep),
            1 => Some(StyleId::Grunt),
            2 => Some(StyleId::Alphabet),
            _ => None,
        }
    }
}

/// Style plus voice parameters (glossary: Voice).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Voice {
    pub style: StyleId,
    /// Semitones, see [`PITCH_RANGE`].
    pub pitch: f64,
    /// Characters per second, see [`SPEED_RANGE`].
    pub speed: f64,
    /// 0..1, see [`VARIATION_RANGE`].
    pub variation: f64,
    /// Random seed (L1.6). Pass e.g. a line id to vary identical lines.
    pub seed: u32,
}

impl Voice {
    pub const fn new(style: StyleId) -> Voice {
        Voice { style, pitch: 0.0, speed: 15.0, variation: 0.0, seed: 0 }
    }

    /// Rejects out-of-range or NaN parameters (L1.7).
    pub fn validate(&self) -> Result<(), Error> {
        if !PITCH_RANGE.contains(&self.pitch) {
            return Err(Error::PitchOutOfRange);
        }
        if !SPEED_RANGE.contains(&self.speed) {
            return Err(Error::SpeedOutOfRange);
        }
        if !VARIATION_RANGE.contains(&self.variation) {
            return Err(Error::VariationOutOfRange);
        }
        Ok(())
    }
}

impl Default for Voice {
    fn default() -> Voice {
        Voice::new(StyleId::Beep)
    }
}

pub(crate) fn validate_sample_rate(sample_rate: u32) -> Result<(), Error> {
    if (MIN_SAMPLE_RATE..=MAX_SAMPLE_RATE).contains(&sample_rate) {
        Ok(())
    } else {
        Err(Error::SampleRateOutOfRange)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    PitchOutOfRange,
    SpeedOutOfRange,
    VariationOutOfRange,
    SampleRateOutOfRange,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Error::PitchOutOfRange => "pitch must be within -12..=12 semitones",
            Error::SpeedOutOfRange => "speed must be within 5..=30 characters per second",
            Error::VariationOutOfRange => "variation must be within 0..=1",
            Error::SampleRateOutOfRange => "sample rate must be within 8000..=192000 Hz",
        })
    }
}

impl core::error::Error for Error {}
