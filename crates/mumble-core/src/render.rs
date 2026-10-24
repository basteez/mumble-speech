use crate::speaker::{Planned, Speaker};
use crate::style::{SoundId, SoundSpec};
use crate::text::classify;
use crate::voice::{validate_sample_rate, Error, Voice};
use alloc::vec::Vec;
use unicode_segmentation::UnicodeSegmentation;

/// Silence after the last sound, in seconds (R7.4).
pub const TAIL_SECONDS: f64 = 0.05;

/// One sound of a line (L2.3).
#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    /// Index of the grapheme in the text.
    pub grapheme_index: u32,
    pub utf8_start: u32,
    pub utf8_len: u32,
    /// UTF-16 offsets, for JavaScript and C# strings.
    pub utf16_start: u32,
    pub utf16_len: u32,
    /// Seconds from the start of the line.
    pub start: f64,
    /// Seconds.
    pub duration: f64,
    /// Which sound of the style this is (L2.3, LD14).
    pub sound: SoundId,
    #[doc(hidden)]
    pub spec: SoundSpec,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Timeline {
    pub events: Vec<Event>,
    /// End of the last sound plus [`TAIL_SECONDS`]; 0 when nothing sounds (R7.4).
    pub duration: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Render {
    /// Mono samples, `ceil(duration × sample_rate)` long.
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub timeline: Timeline,
}

/// The events of a line, without synthesizing audio (L2.2).
pub fn timeline(text: &str, voice: &Voice) -> Result<Timeline, Error> {
    voice.validate()?;
    let mut speaker = Speaker::unchecked(*voice, crate::DEFAULT_SAMPLE_RATE);
    Ok(walk(text, &mut speaker, |_, _| {}))
}

/// Audio and events of a whole line (L2.1). Built on [`Speaker`], so both match exactly (L3.2).
pub fn render(text: &str, voice: &Voice, sample_rate: u32) -> Result<Render, Error> {
    let mut speaker = Speaker::new(*voice, sample_rate)?;
    validate_sample_rate(sample_rate)?;
    let mut sounds = Vec::new();
    let timeline = walk(text, &mut speaker, |speaker, (start, planned)| {
        sounds.push((start, speaker.synthesize(planned)));
    });

    let sr = f64::from(sample_rate);
    let mut samples = alloc::vec![0.0f32; libm::ceil(timeline.duration * sr) as usize];
    for (start, sound) in sounds {
        let offset = libm::round(start * sr) as usize;
        let end = (offset + sound.len()).min(samples.len());
        samples[offset..end].copy_from_slice(&sound[..end - offset]);
    }
    Ok(Render { samples, sample_rate, timeline })
}

/// Plans every grapheme in order, calling `on_sound` for each sounding one.
fn walk(text: &str, speaker: &mut Speaker, mut on_sound: impl FnMut(&mut Speaker, (f64, &Planned))) -> Timeline {
    let mut events = Vec::new();
    let mut t = 0.0;
    let mut utf16 = 0u32;
    for (index, (byte, grapheme)) in text.grapheme_indices(true).enumerate() {
        let utf16_len = grapheme.encode_utf16().count() as u32;
        let (planned, advance) = speaker.plan(classify(grapheme));
        if let Some(p) = planned {
            events.push(Event {
                grapheme_index: index as u32,
                utf8_start: byte as u32,
                utf8_len: grapheme.len() as u32,
                utf16_start: utf16,
                utf16_len,
                start: t,
                duration: p.duration,
                sound: p.sound,
                spec: p.spec,
            });
            on_sound(speaker, (t, &p));
        }
        t += advance;
        utf16 += utf16_len;
    }
    let duration = events.last().map_or(0.0, |e| e.start + e.duration + TAIL_SECONDS);
    Timeline { events, duration }
}
