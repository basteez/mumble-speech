use godot::prelude::*;
use mumble_speech as core;

#[derive(GodotConvert, Var, Export, Default, Clone, Copy, PartialEq, Eq, Debug)]
#[godot(via = i64)]
pub enum Style {
    #[default]
    Beep = 0,
    Grunt = 1,
    Alphabet = 2,
}

/// Style and voice parameters, editable from the inspector.
#[derive(GodotClass)]
#[class(base = Resource)]
pub struct MumbleVoice {
    /// BEEP (Undertale), GRUNT (Banjo-Kazooie) or ALPHABET (Animal Crossing).
    #[export]
    pub style: Style,
    /// Semitones.
    #[export(range = (-12.0, 12.0, 0.5))]
    pub pitch: f64,
    /// Characters per second.
    #[export(range = (5.0, 30.0, 1.0))]
    pub speed: f64,
    /// Random pitch deviation.
    #[export(range = (0.0, 1.0, 0.05))]
    pub variation: f64,
    /// Random seed; use e.g. a line id to vary identical lines.
    #[export(range = (0.0, 4294967295.0, 1.0))]
    pub seed: i64,
    base: Base<Resource>,
}

#[godot_api]
impl IResource for MumbleVoice {
    fn init(base: Base<Resource>) -> Self {
        let d = core::Voice::new(core::StyleId::Beep);
        Self { style: Style::Beep, pitch: d.pitch, speed: d.speed, variation: d.variation, seed: 0, base }
    }
}

#[godot_api]
impl MumbleVoice {
    #[constant]
    pub const BEEP: i64 = 0;
    #[constant]
    pub const GRUNT: i64 = 1;
    #[constant]
    pub const ALPHABET: i64 = 2;
}

impl MumbleVoice {
    pub fn to_core(&self) -> core::Voice {
        core::Voice {
            style: match self.style {
                Style::Beep => core::StyleId::Beep,
                Style::Grunt => core::StyleId::Grunt,
                Style::Alphabet => core::StyleId::Alphabet,
            },
            pitch: self.pitch,
            speed: self.speed,
            variation: self.variation,
            seed: self.seed.clamp(0, i64::from(u32::MAX)) as u32,
        }
    }
}

/// The core voice of an optional resource; a missing resource means the defaults.
pub fn core_voice(voice: &Option<Gd<MumbleVoice>>) -> core::Voice {
    voice.as_ref().map_or_else(|| core::Voice::new(core::StyleId::Beep), |v| v.bind().to_core())
}

pub fn error_name(e: core::Error) -> &'static str {
    match e {
        core::Error::PitchOutOfRange => "PitchOutOfRange",
        core::Error::SpeedOutOfRange => "SpeedOutOfRange",
        core::Error::VariationOutOfRange => "VariationOutOfRange",
        core::Error::SampleRateOutOfRange => "SampleRateOutOfRange",
    }
}
