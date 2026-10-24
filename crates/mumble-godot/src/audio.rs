use godot::classes::audio_stream_wav::Format;
use godot::classes::{AudioServer, AudioStreamWav};
use godot::prelude::*;
use mumble_speech as core;

/// The rate Godot mixes at, so streams play without resampling.
pub fn mix_rate() -> u32 {
    AudioServer::singleton().get_mix_rate() as u32
}

/// A 16-bit mono stream with the same conversion as the core's WAV encoder.
pub fn stream(samples: &[f32], sample_rate: u32) -> Gd<AudioStreamWav> {
    let wav = core::encode_wav(samples, sample_rate);
    let mut stream = AudioStreamWav::new_gd();
    stream.set_format(Format::FORMAT_16_BITS);
    stream.set_mix_rate(sample_rate as i32);
    stream.set_stereo(false);
    stream.set_data(&PackedByteArray::from(&wav[44..]));
    stream
}

/// Code point index of each UTF-8 offset, for Godot `String` indices (design §9.3).
pub fn char_index(text: &str, utf8_offset: u32) -> i64 {
    text[..utf8_offset as usize].chars().count() as i64
}
