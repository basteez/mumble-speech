//! Synthesis and render (R3.9, R5.5, R7.4, L1.5, L2.1, L2.5).

mod common;

use common::*;
use mumble_speech::internals::{alphabet, sound, Mulberry32, SoundSpec, Waveform};
use mumble_speech::*;

fn tone(spec: SoundSpec, duration: f64) -> Vec<f32> {
    sound(&spec, duration, SR, &mut Mulberry32::new(0))
}

fn sine(frequency: f64) -> SoundSpec {
    SoundSpec {
        waveform: Waveform::Sine,
        frequency,
        glide: 0.0,
        duration_ratio: 0.5,
        formants: None,
        vocal_tract: None,
        noise_burst: None,
        gain: 0.5,
    }
}

fn crossings(data: &[f32]) -> usize {
    data.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count()
}

#[test]
fn render_length_is_ceil_of_duration_times_rate() {
    for sr in [8_000, 44_100, 48_000, 192_000] {
        let r = render("Hello", &Voice::new(StyleId::Beep), sr).unwrap();
        assert_eq!(r.samples.len(), (r.timeline.duration * f64::from(sr)).ceil() as usize);
    }
    assert!(render("...", &Voice::new(StyleId::Beep), SR).unwrap().samples.is_empty());
}

#[test]
fn render_is_deterministic() {
    for style in StyleId::ALL {
        let v = Voice { variation: 0.3, ..Voice::new(style) };
        assert_eq!(render("Hello, world!", &v, SR), render("Hello, world!", &v, SR));
    }
}

#[test]
fn sounds_inside_every_event_and_silence_between() {
    for style in StyleId::ALL {
        let r = render("ab cd", &Voice { speed: 10.0, ..Voice::new(style) }, SR).unwrap();
        let events = &r.timeline.events;
        for e in events {
            assert!(rms(slice(&r.samples, e.start, e.start + e.duration)) > 0.01, "{style:?}");
        }
        for pair in events.windows(2) {
            let gap = slice(&r.samples, pair[0].start + pair[0].duration + 0.001, pair[1].start - 0.001);
            assert!(gap.iter().all(|x| *x == 0.0));
        }
    }
}

#[test]
fn plays_the_requested_frequency() {
    let data = tone(sine(440.0), 0.5);
    let hz = crossings(slice(&data, 0.01, 0.49)) as f64 / 0.48 / 2.0;
    assert!((hz - 440.0).abs() < 5.0, "{hz}");
}

#[test]
fn glides_down_with_negative_glide() {
    let data = tone(SoundSpec { glide: -12.0, ..sine(880.0) }, 1.0);
    let ratio = crossings(slice(&data, 0.01, 0.2)) as f64 / crossings(slice(&data, 0.8, 0.99)) as f64;
    assert!(ratio > 1.5);
}

#[test]
fn starts_and_ends_at_zero() {
    for waveform in [Waveform::Square, Waveform::Sawtooth, Waveform::Sine, Waveform::Triangle] {
        let data = tone(SoundSpec { waveform, ..sine(440.0) }, 0.1);
        assert!(data[0].abs() < 0.01);
        assert!(data[data.len() - 1].abs() < 0.01);
    }
}

#[test]
fn limits_each_sound_to_0_98() {
    let loud = SoundSpec { waveform: Waveform::Sawtooth, frequency: 110.0, formants: Some([500.0, 900.0]), gain: 1.0, ..sine(0.0) };
    let peak = tone(loud, 0.2).iter().fold(0f32, |m, x| m.max(x.abs()));
    assert!(peak <= 0.98 && peak > 0.9, "{peak}");
    for style in StyleId::ALL {
        for text in random_texts(20) {
            let r = render(&text, &Voice { pitch: 12.0, variation: 1.0, ..Voice::new(style) }, SR).unwrap();
            assert!(r.samples.iter().all(|x| x.abs() <= 0.98));
        }
    }
}

/// Energy around `f` (±100 Hz) via Goertzel at 10 Hz steps, in dB.
fn band_db(data: &[f32], f: f64) -> f64 {
    let mut energy = 0.0;
    let mut freq = f - 100.0;
    while freq <= f + 100.0 {
        let coeff = 2.0 * (2.0 * std::f64::consts::PI * freq / f64::from(SR)).cos();
        let (mut s1, mut s2) = (0.0, 0.0);
        for &x in data {
            let s0 = f64::from(x) + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        energy += s1 * s1 + s2 * s2 - coeff * s1 * s2;
        freq += 10.0;
    }
    10.0 * energy.log10()
}

#[test]
fn each_vowel_is_closest_to_its_own_formants() {
    // At 100 Hz the harmonics sample the vowel envelope densely; at the real ~240 Hz
    // the result would depend on where harmonics happen to fall.
    let letters = [0u8, 4, 8, 14, 20];
    let sustains: Vec<Vec<f32>> = letters
        .iter()
        .map(|&n| {
            let spec = SoundSpec { frequency: 100.0, glide: 0.0, noise_burst: None, ..alphabet::letter_spec(n) };
            slice(&tone(spec, 0.3), 0.05, 0.25).to_vec()
        })
        .collect();
    // dB in each band relative to the mean of the five vowels: removes the spectral tilt shared by all.
    let relative = |i: usize, f: f64| band_db(&sustains[i], f) - sustains.iter().map(|s| band_db(s, f)).sum::<f64>() / 5.0;
    for i in 0..5 {
        let score = |t: usize| alphabet::VOWELS[t].iter().map(|r| relative(i, r.frequency)).sum::<f64>();
        let best = (0..5).max_by(|a, b| score(*a).total_cmp(&score(*b))).unwrap();
        assert_eq!(best, i, "vowel {}", ['a', 'e', 'i', 'o', 'u'][i]);
    }
}

#[test]
fn renders_500_characters_fast_enough() {
    // Timing is only meaningful with optimizations: run with `cargo test --release`.
    if cfg!(debug_assertions) {
        return;
    }
    // Budget is for a mid-range laptop; CI runners get a slack factor (LD10).
    let slack: f64 = std::env::var("MUMBLE_PERF_SLACK").ok().and_then(|s| s.parse().ok()).unwrap_or(1.0);
    let text: String = "The quick brown fox jumps over the lazy dog, again and again! ".repeat(9).chars().take(500).collect();
    for style in StyleId::ALL {
        let v = Voice { speed: 5.0, variation: 0.3, ..Voice::new(style) };
        render(&text, &v, DEFAULT_SAMPLE_RATE).unwrap(); // warm-up
        let start = std::time::Instant::now();
        render(&text, &v, DEFAULT_SAMPLE_RATE).unwrap();
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        println!("{style:?}: {ms:.1} ms");
        assert!(ms < 50.0 * slack, "{style:?}: {ms:.1} ms, budget 50 ms × {slack} (L2.5)");
    }
}
