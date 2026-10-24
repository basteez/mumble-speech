//! Timeline, voice and style behavior (R3.x, R4.2, R4.3, R7.4, L1.6, L1.7, L2.2, L2.3).

mod common;

use common::*;
use mumble_speech::internals::{alphabet, grunt};
use mumble_speech::*;
use std::collections::HashSet;

fn tl(text: &str, v: Voice) -> Timeline {
    timeline(text, &v).unwrap()
}

#[test]
fn advances_one_slot_per_sounding_grapheme() {
    let events = tl("abc", Voice { speed: 10.0, ..voice(StyleId::Beep) }).events;
    let starts: Vec<f64> = events.iter().map(|e| e.start).collect();
    for (actual, expected) in starts.iter().zip([0.0, 0.1, 0.2]) {
        assert!((actual - expected).abs() < 1e-12);
    }
    assert_eq!(events.iter().map(|e| e.grapheme_index).collect::<Vec<_>>(), [0, 1, 2]);
}

#[test]
fn pauses_take_1_2_and_4_slots() {
    for (text, slots) in [("a b", 2.0), ("a,b", 3.0), ("a.b", 5.0), ("a\nb", 5.0)] {
        let events = tl(text, Voice { speed: 10.0, ..voice(StyleId::Beep) }).events;
        assert!((events[1].start - slots * 0.1).abs() < 1e-12, "{text:?}");
    }
}

#[test]
fn events_never_overlap() {
    for style in StyleId::ALL {
        for text in random_texts(50) {
            let events = tl(&text, Voice { speed: 30.0, ..voice(style) }).events;
            for pair in events.windows(2) {
                assert!(pair[0].start + pair[0].duration <= pair[1].start);
            }
        }
    }
}

#[test]
fn sound_lasts_its_duration_ratio_of_the_slot() {
    let events = tl("a", Voice { speed: 5.0, ..voice(StyleId::Beep) }).events;
    assert!((events[0].duration - 0.1).abs() < 1e-12);
}

#[test]
fn duration_ends_at_last_sound_plus_tail() {
    let t = tl("ab...   ", Voice { speed: 10.0, ..voice(StyleId::Beep) });
    assert!((t.duration - (0.1 + 0.05 + TAIL_SECONDS)).abs() < 1e-12);
    assert_eq!(tl("...", voice(StyleId::Beep)).duration, 0.0);
}

#[test]
fn pitch_transposes_by_2_pow_semitones_over_12() {
    let up = tl("a", Voice { pitch: 12.0, ..voice(StyleId::Beep) });
    let down = tl("a", Voice { pitch: -7.0, ..voice(StyleId::Beep) });
    assert!((up.events[0].spec.frequency - 1040.0).abs() < 1e-9);
    assert!((down.events[0].spec.frequency - 520.0 * 2f64.powf(-7.0 / 12.0)).abs() < 1e-9);
}

#[test]
fn variation_stays_within_twice_its_value_in_semitones() {
    let text = "x".repeat(500);
    let events = tl(&text, Voice { variation: 0.5, ..voice(StyleId::Beep) }).events;
    let semis: Vec<f64> = events.iter().map(|e| semitones(e.spec.frequency, 520.0)).collect();
    assert!(semis.iter().all(|s| s.abs() <= 1.0 + 1e-9));
    assert!(semis.iter().any(|s| s.abs() > 0.1));
    let flat = tl("hello", voice(StyleId::Beep)).events;
    assert!(flat.iter().all(|e| e.spec.frequency == 520.0));
}

#[test]
fn identical_input_gives_identical_timeline() {
    for style in StyleId::ALL {
        let v = Voice { variation: 1.0, seed: 9, ..voice(style) };
        assert_eq!(tl("Hello there", v), tl("Hello there", v));
    }
}

#[test]
fn sounds_depend_on_seed_but_not_on_following_text() {
    let v = voice(StyleId::Grunt);
    let short = tl("Hello", v).events;
    let long = tl("Hello world, how are you?", v).events;
    assert_eq!(short[..], long[..short.len()]);
    let reseeded = tl("Hello world, how are you?", Voice { seed: 1, ..v }).events;
    assert_ne!(long, reseeded);
}

#[test]
fn rejects_out_of_range_voices_and_sample_rates() {
    let base = voice(StyleId::Beep);
    assert_eq!(timeline("a", &Voice { pitch: 12.5, ..base }), Err(Error::PitchOutOfRange));
    assert_eq!(timeline("a", &Voice { speed: 4.0, ..base }), Err(Error::SpeedOutOfRange));
    assert_eq!(timeline("a", &Voice { variation: f64::NAN, ..base }), Err(Error::VariationOutOfRange));
    assert_eq!(render("a", &base, 7_999).unwrap_err(), Error::SampleRateOutOfRange);
    assert_eq!(render("a", &base, 192_001).unwrap_err(), Error::SampleRateOutOfRange);
    assert!(render("a", &base, 8_000).is_ok());
    assert!(Speaker::new(Voice { speed: 31.0, ..base }, SR).is_err());
}

#[test]
fn events_carry_grapheme_utf8_and_utf16_offsets() {
    let events = tl("è👋 a", voice(StyleId::Beep)).events;
    let offsets: Vec<_> =
        events.iter().map(|e| (e.grapheme_index, e.utf8_start, e.utf8_len, e.utf16_start, e.utf16_len)).collect();
    assert_eq!(offsets, [(0, 0, 2, 0, 1), (1, 2, 4, 1, 2), (3, 7, 1, 4, 1)]);
}

#[test]
fn beep_plays_one_sound_with_variant_0() {
    let events = tl("Hello, wörld 42 #!", voice(StyleId::Beep)).events;
    assert_eq!(events.len(), 13);
    assert_eq!(events.iter().map(|e| e.spec.frequency.to_bits()).collect::<HashSet<_>>().len(), 1);
    assert!(events.iter().all(|e| e.sound == SoundId { style: StyleId::Beep, variant: 0 }));
}

#[test]
fn grunt_has_four_distinct_grunts() {
    let g = grunt::GRUNTS;
    let distinct = |f: &dyn Fn(&internals::SoundSpec) -> u64| g.iter().map(f).collect::<HashSet<_>>().len();
    assert_eq!(distinct(&|s| s.frequency.to_bits()), 4);
    assert_eq!(distinct(&|s| s.duration_ratio.to_bits()), 4);
    assert_eq!(distinct(&|s| s.glide.to_bits()), 4);
    assert_eq!(distinct(&|s| s.formants.unwrap()[0].to_bits()), 4);
}

#[test]
fn grunt_never_repeats_and_uses_all_four() {
    for text in random_texts(200) {
        let events = tl(&text, voice(StyleId::Grunt)).events;
        for pair in events.windows(2) {
            assert_ne!(pair[0].sound, pair[1].sound, "{text:?}");
        }
    }
    let events = tl("the quick brown fox jumps over the lazy dog", voice(StyleId::Grunt)).events;
    let variants: HashSet<u8> = events.iter().map(|e| e.sound.variant).collect();
    assert_eq!(variants, HashSet::from([0, 1, 2, 3]));
    // The variant is the index of the grunt that plays (L2.3).
    for e in &events {
        assert_eq!(e.spec.duration_ratio, grunt::GRUNTS[usize::from(e.sound.variant)].duration_ratio);
    }
}

#[test]
fn alphabet_has_26_distinct_sounds_with_the_letter_as_variant() {
    let specs: HashSet<String> = (0..26).map(|n| format!("{:?}", alphabet::letter_spec(n))).collect();
    assert_eq!(specs.len(), 26);
    let events = tl("Abz 7", voice(StyleId::Alphabet)).events;
    let variants: Vec<u8> = events.iter().map(|e| e.sound.variant).collect();
    assert_eq!(variants, [0, 1, 25, alphabet::NEUTRAL_VARIANT]);
    assert!(events.iter().all(|e| e.sound.style == StyleId::Alphabet));
}

#[test]
fn alphabet_plays_the_same_sound_for_the_same_letter() {
    let text = "Banana à la carte, BANANA!";
    let events = tl(text, voice(StyleId::Alphabet)).events;
    let mut by_letter = std::collections::HashMap::new();
    for e in events {
        let g = &text[e.utf8_start as usize..(e.utf8_start + e.utf8_len) as usize];
        let key = internals::classify(g);
        let spec = format!("{:?}", e.spec);
        assert_eq!(by_letter.entry(key).or_insert_with(|| spec.clone()), &spec);
    }
}

#[test]
fn alphabet_vowels_play_themselves() {
    for (n, vowel) in [(0u8, 0usize), (4, 1), (8, 2), (14, 3), (20, 4)] {
        assert_eq!(alphabet::letter_spec(n).vocal_tract, Some(alphabet::VOWELS[vowel]));
    }
}

#[test]
fn alphabet_pitch_stays_within_one_semitone() {
    for n in 0..26 {
        assert!(semitones(alphabet::letter_spec(n).frequency, 240.0).abs() <= 1.0 + 1e-9);
    }
}

#[test]
fn alphabet_digits_and_other_play_the_neutral_sound() {
    let events = tl("7#ж👋", voice(StyleId::Alphabet)).events;
    assert_eq!(events.len(), 4);
    for e in events {
        assert_eq!(e.spec, alphabet::NEUTRAL_SPEC);
    }
}
