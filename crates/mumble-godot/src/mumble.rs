use crate::audio::char_index;
use crate::voice::{core_voice, error_name, MumbleVoice};
use godot::prelude::*;
use mumble_speech as core;

/// Low-level access to the core: raw samples and events.
#[derive(GodotClass)]
#[class(init, base = RefCounted)]
pub struct Mumble {}

#[godot_api]
impl Mumble {
    /// `{ samples: PackedFloat32Array, duration: float, events: Array }`, or `{ error: String }`.
    /// Each event: `char_index`, `char_count`, `start`, `duration`, `style` (MumbleVoice.BEEP…),
    /// `variant` (which sound of the style: grunt 0–3, letter 0–25, 26 neutral).
    #[func]
    fn render(text: GString, voice: Option<Gd<MumbleVoice>>, sample_rate: i64) -> VarDictionary {
        let text = text.to_string();
        let sample_rate = u32::try_from(sample_rate).unwrap_or(0);
        match core::render(&text, &core_voice(&voice), sample_rate) {
            Ok(r) => {
                let mut events = VarArray::new();
                for e in &r.timeline.events {
                    let start = char_index(&text, e.utf8_start);
                    let end = char_index(&text, e.utf8_start + e.utf8_len);
                    let event = vdict! {
                        "char_index" => start,
                        "char_count" => end - start,
                        "start" => e.start,
                        "duration" => e.duration,
                        "style" => e.sound.style as i64,
                        "variant" => i64::from(e.sound.variant),
                    };
                    events.push(&event.to_variant());
                }
                let samples = PackedFloat32Array::from(r.samples.as_slice());
                vdict! {
                    "samples" => &samples,
                    "duration" => r.timeline.duration,
                    "events" => &events,
                }
            }
            Err(e) => vdict! { "error" => error_name(e) },
        }
    }

    /// A 16-bit PCM mono WAV file.
    #[func]
    fn encode_wav(samples: PackedFloat32Array, sample_rate: i64) -> PackedByteArray {
        PackedByteArray::from(core::encode_wav(samples.as_slice(), sample_rate.max(0) as u32).as_slice())
    }
}
