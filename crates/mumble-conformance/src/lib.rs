//! Conformance vectors shared by every binding (specs/design.md §3.1, L5.1, LD7).
//!
//! The vectors are generated from the core and committed. Every suite (core, web, C,
//! Godot, Unity) replays them and must match bit for bit.

use mumble_speech::{render, Error, StyleId, Voice};
use serde::Serialize;
use serde_json::value::RawValue;
use std::fmt::Write as _;
use std::path::PathBuf;

pub const JSON_PATH: &str = "conformance/vectors.json";
pub const HEADER_PATH: &str = "bindings/c/tests/vectors.h";
pub const CSHARP_PATH: &str = "bindings/unity/Tests/EditMode/Vectors.cs";
/// 2: events carry the sound variant instead of a dot (LD14).
pub const FORMAT_VERSION: u32 = 2;

pub struct Case {
    pub id: String,
    pub text: &'static str,
    pub voice: Voice,
    pub sample_rate: u32,
}

const PANGRAM: &str = "The quick brown fox jumps over the lazy dog";
const LONG: &str = "Welcome to the village! The shop opens at nine, and the museum is just past the bridge. \
                    Do you want to hear about the fishing tournament? It starts tomorrow…";

/// The 34 cases of design §3.1: 10 inputs per style, plus 4 error cases.
pub fn cases() -> Vec<Case> {
    let v = |style, pitch, speed, variation, seed| Voice { style, pitch, speed, variation, seed };
    let mut cases = Vec::new();
    for style in StyleId::ALL {
        let inputs: [(&str, Voice, u32); 10] = [
            ("Hello", v(style, 0.0, 15.0, 0.0, 0), 48_000),
            ("Hello, world!", v(style, 12.0, 30.0, 0.5, 7), 44_100),
            ("Perché è così? Sì!", v(style, -12.0, 5.0, 1.0, u32::MAX), 48_000),
            ("a\r\nb\tc…d", v(style, 0.0, 15.0, 0.0, 0), 8_000),
            ("👋 #42 ж", v(style, 0.0, 15.0, 0.25, 1), 22_050),
            ("", v(style, 0.0, 15.0, 0.0, 0), 48_000),
            ("... !!!", v(style, 0.0, 15.0, 0.0, 0), 48_000),
            (PANGRAM, v(style, 3.0, 20.0, 0.0, 0), 96_000),
            (LONG, v(style, -4.0, 12.0, 0.3, 123), 192_000),
            ("Hi", v(style, 0.0, 15.0, 0.0, 42), 44_100),
        ];
        for (i, (text, voice, sample_rate)) in inputs.into_iter().enumerate() {
            cases.push(Case { id: format!("{}-{:02}", style.name(), i + 1), text, voice, sample_rate });
        }
    }
    let ok = Voice::new(StyleId::Beep);
    let errors = [
        ("error-pitch", Voice { pitch: 13.0, ..ok }, 48_000),
        ("error-speed", Voice { speed: 4.0, ..ok }, 48_000),
        ("error-variation", Voice { variation: 1.5, ..ok }, 48_000),
        ("error-sample-rate", ok, 7_999),
    ];
    for (id, voice, sample_rate) in errors {
        cases.push(Case { id: id.into(), text: "a", voice, sample_rate });
    }
    cases
}

/// 64-bit FNV-1a over the little-endian bytes of the samples (LD7).
pub fn pcm_hash(samples: &[f32]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in samples.iter().flat_map(|s| s.to_le_bytes()) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// C ABI error code for each core error (design §9.2).
pub fn error_code(error: Error) -> i32 {
    match error {
        Error::PitchOutOfRange | Error::SpeedOutOfRange | Error::VariationOutOfRange => -3,
        Error::SampleRateOutOfRange => -4,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VectorsFile {
    version: u32,
    hash: &'static str,
    vectors: Vec<Vector>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Vector {
    id: String,
    text: &'static str,
    voice: VoiceJson,
    sample_rate: u32,
    expected: Expected,
}

#[derive(Serialize)]
struct VoiceJson {
    style: &'static str,
    pitch: f64,
    speed: f64,
    variation: f64,
    seed: u32,
}

#[derive(Serialize)]
#[serde(untagged, rename_all = "camelCase")]
enum Expected {
    Ok {
        #[serde(rename = "sampleCount")]
        sample_count: usize,
        #[serde(rename = "pcmHash")]
        pcm_hash: String,
        duration: f64,
        /// One compact object per line, so diffs show which events changed.
        events: Vec<Box<RawValue>>,
    },
    Err {
        error: String,
    },
}

#[derive(Serialize)]
struct EventJson {
    grapheme: u32,
    utf8: [u32; 2],
    utf16: [u32; 2],
    start: f64,
    duration: f64,
    variant: u8,
}

/// Result of replaying one case on the current core.
pub enum Outcome {
    Ok { sample_count: usize, pcm_hash: u64, event_count: usize, render: mumble_speech::Render },
    Err(Error),
}

pub fn run(case: &Case) -> Outcome {
    match render(case.text, &case.voice, case.sample_rate) {
        Ok(r) => Outcome::Ok {
            sample_count: r.samples.len(),
            pcm_hash: pcm_hash(&r.samples),
            event_count: r.timeline.events.len(),
            render: r,
        },
        Err(e) => Outcome::Err(e),
    }
}

/// `conformance/vectors.json` as produced by the current core.
pub fn vectors_json() -> String {
    let vectors = cases()
        .into_iter()
        .map(|case| {
            let expected = match run(&case) {
                Outcome::Ok { sample_count, pcm_hash, render, .. } => Expected::Ok {
                    sample_count,
                    pcm_hash: format!("0x{pcm_hash:016x}"),
                    duration: render.timeline.duration,
                    events: render
                        .timeline
                        .events
                        .iter()
                        .map(|e| {
                            let json = serde_json::to_string(&EventJson {
                                grapheme: e.grapheme_index,
                                utf8: [e.utf8_start, e.utf8_len],
                                utf16: [e.utf16_start, e.utf16_len],
                                start: e.start,
                                duration: e.duration,
                                variant: e.sound.variant,
                            })
                            .expect("event serializes");
                            RawValue::from_string(json).expect("valid JSON")
                        })
                        .collect(),
                },
                Outcome::Err(e) => Expected::Err { error: format!("{e:?}") },
            };
            Vector {
                id: case.id,
                text: case.text,
                voice: VoiceJson {
                    style: case.voice.style.name(),
                    pitch: case.voice.pitch,
                    speed: case.voice.speed,
                    variation: case.voice.variation,
                    seed: case.voice.seed,
                },
                sample_rate: case.sample_rate,
                expected,
            }
        })
        .collect();
    let file = VectorsFile { version: FORMAT_VERSION, hash: "fnv1a64-f32le", vectors };
    serde_json::to_string_pretty(&file).expect("vectors serialize") + "\n"
}

/// `bindings/c/tests/vectors.h` as produced by the current core.
pub fn vectors_header() -> String {
    let mut out = String::from(
        "/* Conformance vectors (specs/design.md §3.1).\n \
         * Generated by `cargo run -p mumble-conformance -- generate`. Do not edit. */\n\
         #ifndef MUMBLE_VECTORS_H\n#define MUMBLE_VECTORS_H\n\n\
         #include <stddef.h>\n#include <stdint.h>\n\n\
         typedef struct {\n\
         \x20   const char *id;\n\
         \x20   const char *text; /* UTF-8 */\n\
         \x20   size_t text_len;\n\
         \x20   uint32_t style;\n\
         \x20   double pitch, speed, variation;\n\
         \x20   uint32_t seed;\n\
         \x20   uint32_t sample_rate;\n\
         \x20   int32_t error; /* 0 = ok, otherwise the expected mumble error code */\n\
         \x20   size_t sample_count;\n\
         \x20   uint64_t pcm_hash;\n\
         \x20   size_t event_count;\n\
         } MumbleVector;\n\nstatic const MumbleVector MUMBLE_VECTORS[] = {\n",
    );
    let cases = cases();
    for case in &cases {
        let (error, sample_count, hash, events) = match run(case) {
            Outcome::Ok { sample_count, pcm_hash, event_count, .. } => (0, sample_count, pcm_hash, event_count),
            Outcome::Err(e) => (error_code(e), 0, 0, 0),
        };
        let v = &case.voice;
        writeln!(
            out,
            "    {{\"{}\", \"{}\", {}, {}, {:?}, {:?}, {:?}, {}u, {}, {}, {}, UINT64_C(0x{:016x}), {}}},",
            case.id,
            c_string(case.text),
            case.text.len(),
            v.style as u32,
            v.pitch,
            v.speed,
            v.variation,
            v.seed,
            case.sample_rate,
            error,
            sample_count,
            hash,
            events
        )
        .unwrap();
    }
    write!(out, "}};\n\n#define MUMBLE_VECTOR_COUNT {}\n\n#endif\n", cases.len()).unwrap();
    out
}

/// `bindings/unity/Tests/EditMode/Vectors.cs` as produced by the current core.
pub fn vectors_csharp() -> String {
    let mut out = String::from(
        "// Conformance vectors (specs/design.md §3.1).\n\
         // Generated by `cargo run -p mumble-conformance -- generate`. Do not edit.\n\n\
         namespace MumbleSpeech.Tests\n{\n\
         \x20   public sealed class VectorEvent\n    {\n\
         \x20       public readonly int Utf16Start, Utf16Length, Variant;\n\
         \x20       public readonly double Start, Duration;\n\n\
         \x20       public VectorEvent(int utf16Start, int utf16Length, double start, double duration, int variant)\n\
         \x20       {\n\
         \x20           Utf16Start = utf16Start; Utf16Length = utf16Length; Start = start; Duration = duration; Variant = variant;\n\
         \x20       }\n    }\n\n\
         \x20   public sealed class Vector\n    {\n\
         \x20       public string Id, Text;\n\
         \x20       public int Style, SampleRate, Error, SampleCount;\n\
         \x20       public double Pitch, Speed, Variation, Duration;\n\
         \x20       public uint Seed;\n\
         \x20       public ulong PcmHash;\n\
         \x20       public VectorEvent[] Events;\n    }\n\n\
         \x20   public static class Vectors\n    {\n\
         \x20       public static readonly Vector[] All =\n        {\n",
    );
    for case in cases() {
        let v = &case.voice;
        let (error, sample_count, hash, duration, events) = match run(&case) {
            Outcome::Ok { sample_count, pcm_hash, render, .. } => {
                (0, sample_count, pcm_hash, render.timeline.duration, render.timeline.events)
            }
            Outcome::Err(e) => (error_code(e), 0, 0, 0.0, Vec::new()),
        };
        writeln!(
            out,
            "            new Vector {{ Id = \"{}\", Text = \"{}\", Style = {}, Pitch = {:?}, Speed = {:?}, Variation = {:?}, Seed = {}u, SampleRate = {}, Error = {}, SampleCount = {}, PcmHash = 0x{:016x}ul, Duration = {:?}, Events = new VectorEvent[]\n            {{",
            case.id,
            csharp_string(case.text),
            v.style as u32,
            v.pitch,
            v.speed,
            v.variation,
            v.seed,
            case.sample_rate,
            error,
            sample_count,
            hash,
            duration,
        )
        .unwrap();
        for e in events {
            writeln!(
                out,
                "                new VectorEvent({}, {}, {:?}, {:?}, {}),",
                e.utf16_start, e.utf16_len, e.start, e.duration, e.sound.variant
            )
            .unwrap();
        }
        out.push_str("            } },\n");
    }
    out.push_str("        };\n    }\n}\n");
    out
}

/// C# string literal body: printable ASCII as is, everything else as `\u`/`\U` escapes.
fn csharp_string(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '"' | '\\' => format!("\\{c}"),
            ' '..='~' => c.to_string(),
            c if (c as u32) <= 0xffff => format!("\\u{:04x}", c as u32),
            c => format!("\\U{:08x}", c as u32),
        })
        .collect()
}

/// Escapes everything outside printable ASCII as 3-digit octal, which C never over-reads.
fn c_string(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'"' | b'\\' => format!("\\{}", b as char),
            0x20..=0x7e => (b as char).to_string(),
            _ => format!("\\{b:03o}"),
        })
        .collect()
}

pub fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Generated files paired with their expected content.
pub fn outputs() -> [(&'static str, String); 3] {
    [(JSON_PATH, vectors_json()), (HEADER_PATH, vectors_header()), (CSHARP_PATH, vectors_csharp())]
}

/// Compares the committed files with the current core. Returns a description of the first difference.
pub fn check() -> Result<(), String> {
    for (path, expected) in outputs() {
        let actual = std::fs::read_to_string(workspace_root().join(path))
            .map_err(|e| format!("{path}: {e} (run `cargo run -p mumble-conformance -- generate`)"))?;
        if actual != expected {
            let line = actual.lines().zip(expected.lines()).position(|(a, b)| a != b).map_or_else(
                || "length differs".to_string(),
                |i| {
                    format!(
                        "line {}:\n  committed: {}\n  current:   {}",
                        i + 1,
                        actual.lines().nth(i).unwrap(),
                        expected.lines().nth(i).unwrap()
                    )
                },
            );
            return Err(format!("{path} does not match the current core output, {line}"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_at_least_30_cases_with_unique_ids() {
        let cases = cases();
        assert!(cases.len() >= 30);
        let ids: std::collections::HashSet<_> = cases.iter().map(|c| c.id.clone()).collect();
        assert_eq!(ids.len(), cases.len());
    }

    #[test]
    fn fnv1a64_matches_reference_values() {
        // FNV-1a 64 of the empty input is the offset basis; of the bytes 00 00 00 00 (0.0f32):
        assert_eq!(pcm_hash(&[]), 0xcbf2_9ce4_8422_2325);
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for _ in 0..4 {
            h = h.wrapping_mul(0x100_0000_01b3);
        }
        assert_eq!(pcm_hash(&[0.0]), h);
    }

    #[test]
    fn csharp_strings_use_unicode_escapes() {
        assert_eq!(csharp_string("a\"\\è👋\n"), "a\\\"\\\\\\u00e8\\U0001f44b\\u000a");
    }

    #[test]
    fn c_strings_use_octal_escapes() {
        assert_eq!(c_string("a\"b\\…\n"), "a\\\"b\\\\\\342\\200\\246\\012");
    }
}
