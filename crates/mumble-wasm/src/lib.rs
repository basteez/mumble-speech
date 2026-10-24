//! WebAssembly exports (specs/design.md §9.1). Data crosses the boundary in compact
//! form — samples as `Float32Array`, events packed in a `Float64Array` — and the
//! TypeScript wrapper in `packages/web` turns it into typed objects.

use mumble_speech as core;
use wasm_bindgen::prelude::*;

/// Numbers per event in [`RenderResult::events`]: grapheme, utf8 start/len,
/// utf16 start/len, start, duration, rgb, size.
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
            f64::from(e.dot.rgb),
            f64::from(e.dot.size as u8),
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
    dot_rgb: i32,
    dot_size: u8,
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

    /// `0xRRGGBB`, or −1 when nothing sounded.
    #[wasm_bindgen(getter, js_name = dotRgb)]
    pub fn dot_rgb(&self) -> i32 {
        self.dot_rgb
    }

    #[wasm_bindgen(getter, js_name = dotSize)]
    pub fn dot_size(&self) -> u8 {
        self.dot_size
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
            dot_rgb: u.dot.map_or(-1, |d| d.rgb as i32),
            dot_size: u.dot.map_or(0, |d| d.size as u8),
        }
    }

    pub fn reset(&mut self) {
        self.0.reset();
    }
}
