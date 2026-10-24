//! WebAssembly exports (specs/design.md §9.1). Data crosses the boundary in compact
//! form — samples as `Float32Array`, events packed in a `Float64Array` — and the
//! TypeScript wrapper in `packages/web` turns it into typed objects.

use mumble_speech as core;
use wasm_bindgen::prelude::*;

/// Numbers per event in [`RenderResult::events`]: grapheme, utf8 start/len,
/// utf16 start/len, start, duration, style, variant.
pub const EVENT_STRIDE: usize = 9;

fn voice(style: u32, pitch: f64, speed: f64, variation: f64, seed: u32) -> Result<core::Voice, JsError> {
    let style = core::StyleId::from_u32(style).ok_or_else(|| JsError::new("UnknownStyle"))?;
    Ok(core::Voice { style, pitch, speed, variation, seed })
}

/// The error name becomes the message; the wrapper maps it to `MumbleError.code`.
/// A match instead of `format!` keeps `core::fmt` out of the module (L4.2).
fn error(e: core::Error) -> JsError {
    JsError::new(match e {
        core::Error::PitchOutOfRange => "PitchOutOfRange",
        core::Error::SpeedOutOfRange => "SpeedOutOfRange",
        core::Error::VariationOutOfRange => "VariationOutOfRange",
        core::Error::SampleRateOutOfRange => "SampleRateOutOfRange",
    })
}

fn pack(timeline: &core::Timeline) -> Vec<f64> {
    let mut out = Vec::with_capacity(timeline.events.len() * EVENT_STRIDE);
    for e in &timeline.events {
        out.extend_from_slice(&[
            f64::from(e.grapheme_index),
            f64::from(e.utf8_start),
            f64::from(e.utf8_len),
            f64::from(e.utf16_start),
            f64::from(e.utf16_len),
            e.start,
            e.duration,
            f64::from(e.sound.style as u32),
            f64::from(e.sound.variant),
        ]);
    }
    out
}

#[wasm_bindgen]
pub struct RenderResult {
    samples: Vec<f32>,
    events: Vec<f64>,
    duration: f64,
}

#[wasm_bindgen]
impl RenderResult {
    /// Moves the samples out; call once.
    #[wasm_bindgen(js_name = takeSamples)]
    pub fn take_samples(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.samples)
    }

    #[wasm_bindgen(js_name = takeEvents)]
    pub fn take_events(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.events)
    }

    #[wasm_bindgen(getter)]
    pub fn duration(&self) -> f64 {
        self.duration
    }
}

#[wasm_bindgen]
pub fn render(
    text: &str,
    style: u32,
    pitch: f64,
    speed: f64,
    variation: f64,
    seed: u32,
    sample_rate: u32,
) -> Result<RenderResult, JsError> {
    let r = core::render(text, &voice(style, pitch, speed, variation, seed)?, sample_rate).map_err(error)?;
    Ok(RenderResult { events: pack(&r.timeline), duration: r.timeline.duration, samples: r.samples })
}

#[wasm_bindgen]
pub fn timeline(
    text: &str,
    style: u32,
    pitch: f64,
    speed: f64,
    variation: f64,
    seed: u32,
) -> Result<RenderResult, JsError> {
    let t = core::timeline(text, &voice(style, pitch, speed, variation, seed)?).map_err(error)?;
    Ok(RenderResult { events: pack(&t), duration: t.duration, samples: Vec::new() })
}

#[wasm_bindgen(js_name = encodeWav)]
pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    core::encode_wav(samples, sample_rate)
}

#[wasm_bindgen]
pub struct Utterance {
    samples: Vec<f32>,
    advance: f64,
    /// Style index of the sound, or −1 when nothing sounded.
    sound_style: i32,
    sound_variant: u8,
}

#[wasm_bindgen]
impl Utterance {
    #[wasm_bindgen(js_name = takeSamples)]
    pub fn take_samples(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.samples)
    }

    #[wasm_bindgen(getter)]
    pub fn advance(&self) -> f64 {
        self.advance
    }

    /// Style index of the sound (0 beep, 1 grunt, 2 alphabet), or −1 when nothing sounded.
    #[wasm_bindgen(getter, js_name = soundStyle)]
    pub fn sound_style(&self) -> i32 {
        self.sound_style
    }

    #[wasm_bindgen(getter, js_name = soundVariant)]
    pub fn sound_variant(&self) -> u8 {
        self.sound_variant
    }
}

#[wasm_bindgen]
pub struct Speaker(core::Speaker);

#[wasm_bindgen]
impl Speaker {
    #[wasm_bindgen(constructor)]
    pub fn new(style: u32, pitch: f64, speed: f64, variation: f64, seed: u32, sample_rate: u32) -> Result<Speaker, JsError> {
        core::Speaker::new(voice(style, pitch, speed, variation, seed)?, sample_rate).map(Speaker).map_err(error)
    }

    pub fn next(&mut self, text: &str) -> Utterance {
        let u = self.0.next(text);
        Utterance {
            samples: u.samples,
            advance: u.advance,
            sound_style: u.sound.map_or(-1, |id| id.style as i32),
            sound_variant: u.sound.map_or(0, |id| id.variant),
        }
    }

    pub fn reset(&mut self) {
        self.0.reset();
    }
}
