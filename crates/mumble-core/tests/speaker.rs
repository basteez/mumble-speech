//! Typewriter mode (L3.1–L3.4).

mod common;

use common::*;
use mumble_speech::*;
use unicode_segmentation::UnicodeSegmentation;

/// Places each grapheme's utterance at the cumulative advance, like a game engine would.
fn typewrite(text: &str, voice: Voice) -> Vec<f32> {
    let mut speaker = Speaker::new(voice, SR).unwrap();
    let mut out = Vec::new();
    let mut t = 0.0;
    for g in text.graphemes(true) {
        let u = speaker.next(g);
        let offset = (t * f64::from(SR)).round() as usize;
        if out.len() < offset + u.samples.len() {
            out.resize(offset + u.samples.len(), 0.0);
        }
        out[offset..offset + u.samples.len()].copy_from_slice(&u.samples);
        t += u.advance;
    }
    out
}

#[test]
fn speaker_matches_render_bit_for_bit() {
    for style in StyleId::ALL {
        for (i, text) in random_texts(200).iter().enumerate() {
            let voice = Voice { pitch: 3.0, variation: 0.4, seed: i as u32, ..Voice::new(style) };
            let rendered = render(text, &voice, SR).unwrap().samples;
            let mut typed = typewrite(text, voice);
            typed.resize(rendered.len(), 0.0); // render adds the silent tail
            assert!(typed.iter().zip(&rendered).all(|(a, b)| a.to_bits() == b.to_bits()), "{style:?} {text:?}");
        }
    }
}

#[test]
fn pauses_return_silence_and_their_advance() {
    let mut speaker = Speaker::new(Voice { speed: 10.0, ..Voice::new(StyleId::Beep) }, SR).unwrap();
    for (g, slots) in [(" ", 1.0), (",", 2.0), (".", 4.0)] {
        let u = speaker.next(g);
        assert!(u.samples.is_empty());
        assert_eq!(u.dot, None);
        assert!((u.advance - slots * 0.1).abs() < 1e-12);
    }
    let u = speaker.next("a");
    assert!(!u.samples.is_empty());
    assert!(u.dot.is_some());
}

#[test]
fn several_graphemes_play_in_order() {
    let voice = Voice { speed: 10.0, ..Voice::new(StyleId::Grunt) };
    let mut together = Speaker::new(voice, SR).unwrap();
    let mut apart = Speaker::new(voice, SR).unwrap();
    let both = together.next("a b");
    let parts: Vec<Utterance> = ["a", " ", "b"].iter().map(|g| apart.next(g)).collect();
    assert!((both.advance - parts.iter().map(|u| u.advance).sum::<f64>()).abs() < 1e-12);
    assert_eq!(both.dot, parts[0].dot);
    assert_eq!(&both.samples[..parts[0].samples.len()], &parts[0].samples[..]);
    // The state moved on as if called one grapheme at a time.
    assert_eq!(together.next("c"), apart.next("c"));
}

#[test]
fn reset_restores_the_initial_state() {
    let mut speaker = Speaker::new(Voice { variation: 1.0, ..Voice::new(StyleId::Grunt) }, SR).unwrap();
    let first: Vec<Utterance> = "hello".graphemes(true).map(|g| speaker.next(g)).collect();
    speaker.reset();
    let again: Vec<Utterance> = "hello".graphemes(true).map(|g| speaker.next(g)).collect();
    assert_eq!(first, again);
}
