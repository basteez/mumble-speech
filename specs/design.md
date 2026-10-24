# Design

Status: **approved on 2026-10-19.** References to requirements in square
brackets, for example [L3.2]. The algorithms (§4–§7) come from the first version
in TypeScript; the points that changed are in §8.

## 1. Repository structure

Monorepo with Cargo and npm workspaces.

```
crates/
  mumble-core/        # package `mumble-speech` (LQ1): all the logic, #![no_std] + alloc [L1.1, L1.3]
  mumble-ffi/         # C ABI: cdylib + staticlib, header via cbindgen [L4.3–L4.5]
  mumble-wasm/        # wasm-bindgen exports [L4.1]
  mumble-godot/       # GDExtension via godot-rust (gdext) [L4.6]
  mumble-conformance/ # vector generator [L5.1]
packages/
  web/                # @mumble-speech/web: TS wrapper + WebAudioPlayer [L4.1]
bindings/
  c/                  # generated mumble.h, CMake example and tests
  godot/              # addons/mumble_speech + example project and tests
  unity/              # UPM package: Runtime/, Plugins/, Samples~/, Tests/
apps/
  playground/         # private web playground, consumes @mumble-speech/web [L6.1]
docs/                 # VitePress documentation site [L7] (§12)
conformance/
  vectors.json        # [L5.1]
specs/
```

## 2. Core API (Rust)

```rust
pub enum StyleId { Beep, Grunt, Alphabet }

pub struct Voice {
    pub style: StyleId,
    pub pitch: f64,      // semitones, −12..12
    pub speed: f64,      // characters/s, 5..30
    pub variation: f64,  // 0..1
    pub seed: u32,       // [L1.6]
}

/// Which sound of the style an event plays [L2.3] (LD14): beep 0; grunt 0–3;
/// alphabet 0–25 for a–z, 26 for the neutral sound.
pub struct SoundId { pub style: StyleId, pub variant: u8 }

impl Voice {
    pub const fn new(style: StyleId) -> Voice;      // pitch 0, speed 15, variation 0, seed 0
    pub fn validate(&self) -> Result<(), Error>;    // [L1.7]
}

pub enum Error { PitchOutOfRange, SpeedOutOfRange, VariationOutOfRange, SampleRateOutOfRange }

pub struct Event {
    pub grapheme_index: u32,
    pub utf8_start: u32, pub utf8_len: u32,
    pub utf16_start: u32, pub utf16_len: u32,             // for JS and C# [L2.3]
    pub start: f64, pub duration: f64,                    // seconds
    pub sound: SoundId,
}

pub struct Timeline { pub events: Vec<Event>, pub duration: f64 }

pub fn timeline(text: &str, voice: &Voice) -> Result<Timeline, Error>;                 // [L2.2]
pub fn render(text: &str, voice: &Voice, sample_rate: u32) -> Result<Render, Error>;  // [L2.1]
pub struct Render { pub samples: Vec<f32>, pub sample_rate: u32, pub timeline: Timeline }
pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Vec<u8>;                      // [L2.4]

pub struct Speaker { /* voice, sample rate, style rng, noise rng, previous variant */ } // [L3]
impl Speaker {
    pub fn new(voice: Voice, sample_rate: u32) -> Result<Speaker, Error>;
    pub fn next(&mut self, text: &str) -> Utterance;
    pub fn reset(&mut self);
}
pub struct Utterance { pub samples: Vec<f32>, pub advance: f64, pub sound: Option<SoundId> }
```

`render` is implemented on top of `Speaker`: for each grapheme it uses the same
planning and synthesis as `next` and writes the samples at
`round(t × sampleRate)`, with `t` equal to the cumulative advances. This way
L3.2 holds by construction, and it is verified by a test anyway.

The style rng and the noise rng (consonant bursts) are both part of the
Speaker state, so they advance in the same order in both APIs.

Test-only internals (sound specs, style tables, single-sound synthesis) are
exposed under `mumble_speech::internals`, `#[doc(hidden)]` and outside the
stable API.

Core dependencies: `libm` (deterministic math [L1.4]) and `unicode-segmentation`
(graphemes), both `no_std`. Nothing else. `unicode-normalization` is only a
dev-dependency, used to generate and verify the folding tables (§4.1, LD11).

## 3. Cross-platform determinism [L1.4]

- All internal computations in `f64`, output converted to `f32` only at the end.
- Transcendental functions (`sin`, `cos`, `exp`, `pow`, `log2`) only from `libm`,
  never from `std` or from the system libm, which differ across platforms.
- Rust does not fuse operations into FMA automatically; `mul_add` is not used.
- No iteration over `HashMap`; tables are arrays.
- Sample positions with `libm`'s `round`.
- Verification: the same conformance vectors run on native (macOS, Windows,
  Linux) and on WASM in CI, comparing the PCM hash.

### 3.1 Conformance vectors [L5.1, L5.2] (LD7)

`crates/mumble-conformance` holds the case list and a small CLI:

- `cargo run -p mumble-conformance -- generate` writes `conformance/vectors.json`
  and `bindings/c/tests/vectors.h` from the current core;
- `cargo run -p mumble-conformance -- check` fails if either file differs from
  what the current core produces;
- its integration test does the same check, so `cargo test` verifies the
  vectors on every CI platform [L1.4].

Vectors are regenerated only for an intentional behavior change, which per the
process rules is in the specs first; the PR diff of `vectors.json` shows exactly
which outputs changed.

Cases (34): for each style, the same 10 inputs, plus 4 error cases.

| # | Text | Voice (pitch, speed, variation, seed) | Sample rate |
|---|---|---|---|
| 01 | `Hello` | 0, 15, 0, 0 | 48,000 |
| 02 | `Hello, world!` | +12, 30, 0.5, 7 | 44,100 |
| 03 | `Perché è così? Sì!` | −12, 5, 1, 4,294,967,295 | 48,000 |
| 04 | `a\r\nb\tc…d` | 0, 15, 0, 0 | 8,000 |
| 05 | `👋 #42 ж` | 0, 15, 0.25, 1 | 22,050 |
| 06 | empty | 0, 15, 0, 0 | 48,000 |
| 07 | `... !!!` | 0, 15, 0, 0 | 48,000 |
| 08 | pangram | +3, 20, 0, 0 | 96,000 |
| 09 | three sentences, ~180 characters | −4, 12, 0.3, 123 | 192,000 |
| 10 | `Hi` | 0, 15, 0, 42 | 44,100 |
| E1–E4 | `a` | pitch 13 / speed 4 / variation 1.5 / valid | 48,000 / 48,000 / 48,000 / 7,999 |

JSON schema (`version: 2` since LD14; values below are illustrative):

```json
{
  "version": 2,
  "hash": "fnv1a64-f32le",
  "vectors": [
    {
      "id": "beep-02",
      "text": "Hello, world!",
      "voice": { "style": "beep", "pitch": 12, "speed": 30, "variation": 0.5, "seed": 7 },
      "sampleRate": 44100,
      "expected": {
        "sampleCount": 23373,
        "pcmHash": "0x…",
        "duration": 0.53,
        "events": [
          { "grapheme": 0, "utf8": [0, 1], "utf16": [0, 1],
            "start": 0, "duration": 0.0166, "variant": 0 }
        ]
      }
    },
    { "id": "error-pitch", "text": "a", "voice": { … }, "sampleRate": 48000,
      "expected": { "error": "PitchOutOfRange" } }
  ]
}
```

- `pcmHash`: 64-bit FNV-1a (offset `0xcbf29ce484222325`, prime
  `0x100000001b3`) over the little-endian bytes of the `f32` samples, as a hex
  string (a JSON number cannot hold a `u64` exactly in JavaScript).
- Floats are written in shortest round-trip form and compared exactly.
- `utf8` and `utf16` are `[start, length]`.
- `vectors.h` carries, per vector, text, voice, sample rate, expected sample
  count, hash, event count and error code (events are checked by the other
  suites; C checks counts and hash).
- `bindings/unity/Tests/EditMode/Vectors.cs` carries the same data plus every
  event (UTF-16 start and length, times, variant) as C# literals, so Unity
  needs no JSON parser; doubles are written in round-trip form and compared
  exactly. It is the third generated file checked by `check`.

## 4. Algorithms

### 4.1 Normalization and tokenization [R1.4, R1.5]

1. `base = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()`.
2. Classification, in this order:
   - `\n` or `. ! ? …` → `pause-long`
   - `, ; :` → `pause-short`
   - spaces and tabs → `space`
   - `base` in `a–z` → `letter`
   - `0–9` → `digit`
   - everything else → `other` (emoji, non-Latin alphabets, symbols)
3. Iteration is per *grapheme* (`Intl.Segmenter`, `unicode-segmentation` in Rust), so a composite emoji counts as a single token.

Rust implementation (LD11): step 1 is not computed at runtime. Two tables,
generated from `unicode-normalization` by
`cargo run -p mumble-speech --example gen_tables` and committed as
`src/fold_tables.rs`, give the same result:

- `FOLD`: every non-ASCII character whose NFD, without marks, lowercased, is
  exactly one character in `a–z` or `0–9`, with that character;
- `IGNORABLE`: ranges of characters whose NFD is only marks (they vanish).

A grapheme is a letter or digit when, skipping ignorable characters, exactly one
character is left and it folds to `a–z` or `0–9` (ASCII directly, otherwise via
`FOLD`). This equals step 1 for any grapheme, because NFD and lowercasing work
character by character and the result must be a single character, so the
canonical reordering of marks cannot change it. A test compares both methods
on every Unicode scalar value.

### 4.2 Determinism [R3.8]

- `seed = fnv1a(styleId) XOR voice.seed` (LD1; in the first version it was derived from the text).
- `rng = mulberry32(seed)`: the only source of randomness, consumed in token order.
- No other source of randomness in the core.

### 4.3 Scheduling [R3.6, R3.7, R7.4]

```
slot = 1 / voice.speed
t = 0
for each token:
  space        → t += 1 slot
  pause-short  → t += 2 slot
  pause-long   → t += 4 slot
  sounding     → { sound, variant } = style.voice(token, rng, prev)
                 dur = sound.durationRatio * slot      // ≤ 0.9 slot ⇒ no overlap
                 semitones = voice.pitch + (rng() * 2 - 1) * voice.variation * 2
                 freq = sound.frequency * 2^(semitones / 12)
                 emit event(start = t, duration = dur)
                 t += 1 slot
duration = last event.start + last event.duration + 0.05
```

Note: `rng()` for the variation is **always** consumed, even with variation 0,
so that the styles' random sequence does not depend on the variation.

## 5. Styles

Base frequencies before transposition [R4.2].

### 5.1 `beep` [R3.1]

| Property | Value |
|---|---|
| Waveform | `square` |
| Frequency | 520 Hz |
| `durationRatio` | 0.5 |
| Gain | 0.35 |
| Variant | 0 |

No use of `rng` inside the style.

### 5.2 `grunt` [R3.2, R3.3]

Four fixed grunts: low-pass filtered `sawtooth` wave, downward glissando.

| Variant | Frequency | Glide | `durationRatio` | Formants |
|---|---|---|---|---|
| 0 | 140 Hz | −3 | 0.5 | 600 / 1000 |
| 1 | 180 Hz | −5 | 0.75 | 700 / 1200 |
| 2 | 110 Hz | −2 | 0.9 | 500 / 900 |
| 3 | 210 Hz | −6 | 0.6 | 800 / 1400 |

Choice: `i = floor(rng() * 4)`; if `i` matches the previous grunt,
`i = (i + 1 + floor(rng() * 3)) % 4`. This way the distribution stays uniform over the
three allowed grunts.

### 5.3 `alphabet` [R3.4, R3.5, R3.9, R3.10] (D9)

Each letter = optional consonant attack (filtered noise) + vowel
synthesized with a 3-formant cascade vocal tract.

Formants of the Italian vowels (medium-high voice, suited to a pitch of
240 Hz), as frequency / bandwidth pairs in Hz:

| Vowel | F1 | F2 | F3 |
|---|---|---|---|
| a | 850 / 90 | 1400 / 110 | 2800 / 170 |
| e | 450 / 80 | 2200 / 110 | 2900 / 170 |
| i | 310 / 70 | 2600 / 120 | 3300 / 200 |
| o | 500 / 80 | 900 / 100 | 2800 / 170 |
| u | 340 / 70 | 800 / 100 | 2700 / 170 |
| schwa | 550 / 90 | 1550 / 110 | 2650 / 170 |

Vowel of each letter:

- the vowels `a e i o u` use **their own vowel** [R3.9];
- the consonants use the vowel of their English name, Animalese style (D4):

| Consonants | Vowel |
|---|---|
| b c d g p t v z | i |
| f l m n s x | e |
| h j k | e |
| r y | a |
| q w | u |

With `n = letter index (a = 0 … z = 25)`:

- `sawtooth` waveform, base frequency `240 × 2^(o / 12)` with
  `o = ((n × 7) mod 5 − 2) × 0.5` semitones, hence `o ∈ {−1, −0.5, 0, 0.5, 1}` [R3.10];
- `glide` −1.5 semitones: the pitch drops slightly within each syllable, as in speech;
- `noiseBurst` only for consonants: `centerHz = 1500 + n × 250`, `durationMs = 12`;
- `durationRatio = 0.85`, gain 0.4;
- variant `n`.

The tuple (vowel, `o`, `centerHz`) is different for each letter; a test
verifies that the 26 `SoundSpec`s are all distinct [R3.4].

Digits and `other`: schwa, 240 Hz, same glide, no noise, variant 26 [R3.5].

Colors and dot sizes for these variants are a playground choice
([`playground/design.md`](playground/design.md) §7.3, R6.2), not library data
(LD14).

Verification of R3.9: for each vowel a long event is synthesized at 100 Hz (at
240 Hz the harmonics are too sparse and the result depends on where they fall) and the
energy (Goertzel, in dB) is measured in the ±100 Hz bands around F1, F2 and F3 of
each of the five vowels. Each band is normalized by subtracting the mean
of the five vowels, which removes the common spectral tilt (−6 dB/octave),
that would otherwise always favor the vowels with low formants. The vowel with
the highest score must be the right one. The test uses only the formant
table, not the filter code.
## 6. Synthesis [R5.5, L2.5] (D6)

Pure function: timeline + sample rate → `f32` samples.

- Buffer of `ceil(duration × sampleRate)` samples. Each event writes only
  to its own samples `[start, start + duration)`, so the cost is linear in the
  number of sounding samples.
- Oscillator: phase accumulator. `square` and `sawtooth` with PolyBLEP
  correction against aliasing; `sine` and `triangle` direct.
- `glide`: exponential instantaneous frequency from `f` to `f × 2^(glide/12)` across
  the event.
- `formants`: two band-pass biquads in parallel (RBJ cookbook, peak gain
  0 dB, Q = 8), each × 3 makeup (D5). Filter state reset at
  every event.
- `vocalTract`: Klatt resonators in cascade (unity gain at DC,
  `y = A·x + B·y₁ + C·y₂`), one per formant, followed by a fixed calibration
  gain that brings the vowels' level close to that of the
  other styles. In cascade the relative amplitudes of the formants already come out correct,
  without tuning a gain per formant (D9).
- Envelope: linear attack 3 ms, sustain, linear release over the last 15 ms
  (or 30% of the duration if shorter), so there are no clicks.
- `noiseBurst`: white noise from `mulberry32(fnv1a('noise'))` (never
  `Math.random`) → band-pass at `centerHz`, Q = 2 → exponential decay
  down to −60 dB in `durationMs`.
- Master gain 0.8. The peak is limited **per sound**: if a sound exceeds 0.98,
  that sound is scaled to bring it back to 0.98 [R5.5] (LD2).
## 7. WAV [R7.1, L2.4]

`encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer`

- Standard RIFF/WAVE header, `fmt ` PCM (format 1), 1 channel, 16 bit.
- Conversion: `clamp(x, −1, 1)`, then `x < 0 ? x × 0x8000 : x × 0x7FFF`, little-endian.
- Pure function, takes the render output directly.

## 8. Changes from the first version (TypeScript)

| # | What | Before | Now | Rationale |
|---|---|---|---|---|
| LD1 | Seed | `fnv1a(style + text)` | `fnv1a(style) XOR voice.seed` | In typewriter mode the Speaker does not know the text that follows [L1.6, L3.2]. Whoever wants variety between lines passes a different seed, for example the line's id. |
| LD2 | Peak limiting | Global buffer scaling | Each sound limited to 0.98 on its own | With a global scaling `render` and Speaker would not match. Events do not overlap, so R5.5 still holds. |
| LD3 | Dot color (superseded by LD14) | CSS string (`var(--teal)`, `hsl(…)`) | `0xRRGGBB` | Platform-neutral. The CSS theme colors become: teal `0x3f8f78`, blue `0x3f6fc4`, olive `0x7d8f45`, orange `0xb85a33`, muted `0x9aa0a6`; `hsl(h 55% 55%)` is converted to RGB. |
| LD4 | Default sample rate | 44,100 | 48,000 | Default of Unity and of modern devices. |
| LD5 | Implementation | TypeScript (in the playground) | Rust | A single implementation [L1.1]. The Vitest tests of the TS core become Rust tests and conformance vectors. |

## 9. Bindings

### 9.1 Web: `mumble-wasm` + `@mumble-speech/web` [L4.1, L4.2]

- `wasm-bindgen` (pinned version, `0.2.129`) with `--target web`,
  `--remove-name-section` and `--remove-producers-section`; Cargo profile `wasm`
  (`opt-level = "z"`, LTO, `panic = "abort"`) and `wasm-opt -Oz` (npm `binaryen`).
- The optimized `.wasm` is inlined in the JS as base64 and instantiated with
  `WebAssembly.instantiate` inside `init()` (LD12): no file to fetch or locate,
  so the same code works in browsers, Node and any bundler without
  configuration.
- Build: `npm run build -w @mumble-speech/web` runs
  `packages/web/scripts/build-wasm.mjs` (cargo build, wasm-bindgen, wasm-opt,
  base64 module into `src/generated/`, not committed) and `tsc` to `dist/`.
- Objects cross the boundary in compact form: samples as
  `Float32Array`, events as a packed `Float64Array`. The TS wrapper
  turns them into typed objects. No `serde`, for size [L4.2].
- TS API:

```ts
await init();                        // instantiates the WASM, idempotent; other calls throw before it
render(text, voice, sampleRate = 48000) → { samples: Float32Array; sampleRate; timeline: Timeline }
timeline(text, voice) → Timeline
encodeWav(samples, sampleRate) → Uint8Array
new Speaker(voice, sampleRate = 48000)  .next(text) → Utterance  .reset()  .free()
new WebAudioPlayer()  .unlock()  .play(samples, sampleRate)  .stop()  .position()

type Voice = { style: 'beep' | 'grunt' | 'alphabet'; pitch?; speed?; variation?; seed? }  // defaults 0, 15, 0, 0
type MumbleEvent = { graphemeIndex; utf8Start; utf8Length; utf16Start; utf16Length;
                     start; duration; sound: SoundId }
type SoundId = { style: 'beep' | 'grunt' | 'alphabet'; variant: number }
type Utterance = { samples: Float32Array; advance: number; sound: SoundId | null }
class MumbleError extends Error { code: 'PitchOutOfRange' | 'SpeedOutOfRange'
                                  | 'VariationOutOfRange' | 'SampleRateOutOfRange' | 'UnknownStyle' }
```

- `WebAudioPlayer` is the playground's `Player`, moved into the package.
- Tests: Vitest in Node loads the WASM and runs the vectors [L5.2], checks
  Speaker/render equivalence (L3.2), the L2.5 WASM budget (with `MUMBLE_PERF_SLACK`,
  LD10) and the size budget: gzip of the JS in `dist/`, WASM included, under
  60 KB [L4.2]. An external consumption check
  (`packages/web/scripts/consume-check.mjs`) runs `npm pack`, installs the
  tarball in an empty project and renders a vector through the public API [L6.2].

### 9.2 C ABI: `mumble-ffi` [L4.3–L4.5]

```c
#define MUMBLE_ABI_VERSION 2   // 2: sound identifier instead of dot (LD14)
uint32_t mumble_abi_version(void);

typedef struct { uint32_t style; double pitch, speed, variation; uint32_t seed; } MumbleVoice;
typedef struct { uint32_t grapheme_index, utf8_start, utf8_len, utf16_start, utf16_len;
                 double start, duration; uint32_t style; uint8_t variant; } MumbleEvent;
typedef struct { const float *samples; size_t sample_count; double advance;
                 uint32_t style; uint8_t variant; uint8_t has_sound; } MumbleUtterance;

typedef struct MumbleRender MumbleRender;   // opaque, owned by the caller
int32_t mumble_render(const char *utf8, size_t len, const MumbleVoice *v,
                      uint32_t sample_rate, MumbleRender **out);
const float *mumble_render_samples(const MumbleRender *r, size_t *len);  // valid until free
double mumble_render_duration(const MumbleRender *r);
size_t mumble_render_event_count(const MumbleRender *r);
int32_t mumble_render_event(const MumbleRender *r, size_t i, MumbleEvent *out);
void mumble_render_free(MumbleRender *r);

typedef struct MumbleSpeaker MumbleSpeaker; // opaque, owned by the caller
int32_t mumble_speaker_new(const MumbleVoice *v, uint32_t sample_rate, MumbleSpeaker **out);
int32_t mumble_speaker_next(MumbleSpeaker *s, const char *utf8, size_t len,
                            MumbleUtterance *out);  // out->samples valid until the next call or free
void mumble_speaker_reset(MumbleSpeaker *s);
void mumble_speaker_free(MumbleSpeaker *s);

int32_t mumble_encode_wav(const float *samples, size_t len, uint32_t sample_rate,
                          uint8_t **out, size_t *out_len);
void mumble_bytes_free(uint8_t *p, size_t len);
```

- Codes: `0` ok, `<0` error: `-1` null argument, `-2` invalid UTF-8, `-3` voice
  out of range or unknown style, `-4` sample rate out of range, `-5` index out
  of range, `-99` panic caught with `catch_unwind` [L4.4]. On error, out
  parameters are left untouched.
- `free` functions accept null. Strings are `(pointer, length)`, not
  NUL-terminated, so C# and other hosts can pass UTF-8 buffers directly.
- Header `bindings/c/include/mumble.h`, generated by `cbindgen` from
  `crates/mumble-ffi` and committed; CI fails if it is out of date
  (`cbindgen --verify`).
- Tests (`bindings/c`, CMake + CTest, linked against the shared library built
  by Cargo): **all** conformance vectors from `tests/vectors.h` (sample count,
  FNV-1a hash, event count, error codes), Speaker/render equivalence on a few
  vectors, null-argument and index errors, `mumble_abi_version`. An example
  (`examples/hello.c`) writes a WAV file.
- CI (`ffi` job): Linux x64, Windows x64, macOS universal (arm64 + x86_64 built
  separately and joined with `lipo`; the tests run against the universal
  library).

### 9.3 Godot: `mumble-godot` [L4.6]

- GDExtension written in Rust with `gdext` (`godot = "0.5.5"`, feature
  `api-4-3`), which uses the core directly (not the C ABI): one fewer layer,
  native Godot types. `compatibility_minimum = 4.3`, so the same build loads in
  every Godot from 4.3 on.
- `bindings/godot` is itself a Godot project: `addons/mumble_speech/` (what
  users copy: `.gdextension` + `bin/`), `example/` (a dialogue scene, L4.9) and
  `tests/`. `bin/` is not committed: `bindings/godot/build.sh` builds the crate
  and copies the library there.
- Indices exposed to GDScript are **code point** indices in the Godot `String`
  (how `String` and `visible_characters` count), converted from the core's
  UTF-8 offsets.
- Classes:
  - `MumbleVoice` (`Resource`): `style` (enum `BEEP`, `GRUNT`, `ALPHABET`),
    `pitch` (−12..12), `speed` (5..30), `variation` (0..1), `seed`, editable
    from the inspector with ranges.
  - `Mumble` (`RefCounted`, static functions, low level):
    `render(text, voice, sample_rate) → Dictionary` with `samples`
    (`PackedFloat32Array`), `duration` and `events` (array of dictionaries:
    `char_index`, `char_count`, `start`, `duration`, `style`, `variant`), or
    `{ "error": "<code>" }`; `encode_wav(samples, sample_rate) → PackedByteArray`.
  - `MumbleSpeaker` (`Node`): `voice`, `bus`, `volume_db`; `say(text)`,
    `speak_character(text) → float` (plays one character, returns the advance
    in seconds), `stop()`, `is_speaking()`, `render_stream(text) →
    AudioStreamWAV` (16-bit, at the `AudioServer` mix rate); signals
    `character_spoken(char_index)` and `finished`. Playback goes through an
    internal `AudioStreamPlayer`; `character_spoken` follows the audio clock
    (playback position + time since last mix − output latency, as in D7).
  - `MumbleTypewriter` (`Node`): `label: NodePath` (`Label` or
    `RichTextLabel`), `speaker: NodePath`; `type_text(text)` sets the text and
    reveals it grapheme by grapheme through `visible_characters`, calling
    `speak_character` and waiting its advance; `skip()` shows everything;
    `is_typing()`; signal `finished`.
- Tests (`tests/run_tests.gd`, run with
  `godot --headless --path bindings/godot -s res://tests/run_tests.gd`): all
  conformance vectors through `Mumble.render` with the FNV-1a hash computed in
  GDScript, error codes, `MumbleVoice` defaults and ranges, typewriter reveal
  and `finished`. CI (`godot` job, Linux): Godot 4.3 (minimum) and 4.7.2.

### 9.4 Unity [L4.7]

Package `com.mumble-speech.unity` in `bindings/unity` (Unity 2022.3 LTS or
later, C# 9). Namespace `MumbleSpeech`.

- `Runtime/Core/` (assembly `MumbleSpeech.Core`, **no `UnityEngine`
  reference**): the interop layer.
  - `Native.cs`: `[DllImport("mumble_ffi")]` over the C ABI; structs with
    `LayoutKind.Sequential` matching `mumble.h` field by field.
  - `Mumble.cs`: `Mumble.Render(text, voice, sampleRate)` → `MumbleRender`
    (`float[] Samples`, `Duration`, `MumbleEvent[] Events`; events and
    utterances carry the sound identifier as `Style` and `Variant`, plus
    `HasSound` on utterances),
    `Mumble.EncodeWav(samples, sampleRate)`, `Speaker` (`Next(text)` →
    `MumbleUtterance` with samples and advance, `Reset`, `Dispose`),
    `MumbleVoiceSettings` (style, pitch, speed, variation, seed),
    `MumbleException` with the error code. Text goes to the C ABI as UTF-8
    bytes; event indices are **UTF-16** (`CharIndex`, `CharLength`), so they
    index C# strings directly.
- `Runtime/` (assembly `MumbleSpeech`, references `UnityEngine`):
  - `MumbleVoice` (`ScriptableObject`, `CreateAssetMenu`): the settings, with
    `[Range]` attributes.
  - `MumbleSpeaker` (`MonoBehaviour`, requires `AudioSource`): `Say(text)`
    renders at `AudioSettings.outputSampleRate`, builds an `AudioClip`
    (`AudioClip.Create` + `SetData`) and starts it with `PlayScheduled`;
    `SpeakCharacter(text)` → seconds to wait; `ResetSpeaker()`, `Stop()`,
    `IsSpeaking`; `UnityEvent<int> OnCharacter` (UTF-16 index) and
    `UnityEvent OnFinished`, driven by `AudioSettings.dspTime` (the audio
    clock, as in D7).
- `Runtime/TMP/` (assembly `MumbleSpeech.TMP`, compiled only when TextMeshPro
  is available: `com.unity.textmeshpro`, or `com.unity.ugui` ≥ 2.0 which
  contains it, via `versionDefines`): `MumbleTypewriterTMP` reveals a
  `TMP_Text` with `maxVisibleCharacters`, grapheme by grapheme
  (`StringInfo` text elements), waiting each advance; `Skip()`, `IsTyping`,
  `OnFinished`.
- `Plugins/{macOS,Windows/x86_64,Linux/x86_64}/`: the C ABI library
  (macOS universal). Binaries are not committed: `bindings/unity/build.sh`
  builds and copies them. Their `.meta` files (platform settings) are
  committed, as are `.meta` files for every package asset (required for
  immutable packages).
- `Samples~/Basic`: a script that types a line with a `MumbleSpeaker` [L4.9].
- `Tests/EditMode` (NUnit): all conformance vectors through `MumbleSpeech.Core`
  (`Vectors.cs` generated, checks in `VectorChecks.cs`, shared with CI), plus
  Speaker/render equivalence and error codes.
- Verification (LD13): CI job `unity-interop` builds `Runtime/Core` and the
  shared checks with the .NET SDK on Linux, **C# 9** like Unity, and runs every
  vector against the real native library: this covers struct layout,
  marshalling and UTF-16 indices. The `UnityEngine` parts (components, TMP,
  sample) are verified manually (U1–U3), since Unity in CI needs a license.

## 10. Build and CI [L4.3, L5.2]

GitHub Actions, matrix:

| Job | Runner | Produces / verifies |
|---|---|---|
| core | ubuntu, macos, windows | `cargo test`, native vectors, L2.5 benchmark |
| web | ubuntu | package build, Vitest (WASM vectors, L4.2 size budget), external consumption check [L6.2] |
| ffi | ubuntu, macos, windows | native library (macOS universal with `lipo`), CTest tests |
| godot | ubuntu, Godot 4.3 and 4.7.2 | GDExtension build, headless tests (vectors, typewriter) |
| unity-interop | ubuntu, .NET 8 SDK, C# 9 | `Runtime/Core` + shared vector checks against the native library [LD13] |
| playground | ubuntu | build and tests of `apps/playground` against the workspace package [L6.1] |

Performance budgets (L2.5, playground R5.4) are defined for a mid-range laptop.
Shared CI runners are slower and noisy, so CI sets `MUMBLE_PERF_SLACK=3`: the
benchmarks still run (after a warm-up) and fail on order-of-magnitude
regressions, while the exact budget is checked locally, where the slack
defaults to 1 (LD10).
| site | ubuntu | builds docs + playground on every PR; deploys on push to `main` (§12) |
| release | on tag / manual | four release artifacts and the GitHub Release (§13) |

## 11. Migration

1. Port of the core to Rust with the TS core's tests (in the playground) translated:
   same properties (determinism, no overlaps, grunts never repeated,
   vowels R3.9…).
2. Vitest snapshots → conformance vectors. The hashes change compared to TS
   because of LD1–LD2 and the use of `libm`: this is expected.
3. The playground (`apps/playground`) switches to `@mumble-speech/web` as an
   npm workspace dependency [L6.1]. That migration is tracked in
   `playground/tasks.md` (P1–P3).
4. Only after the playground works with the package are C ABI,
   Godot and Unity added.

## 12. Documentation site [L7] (LD15)

- `docs/`: VitePress site, npm workspace `@mumble-speech/docs` (private).
  Pages: home (what it is, the three styles, link to the playground);
  guide (getting started, styles, concepts: voice, timeline, typewriter and
  advance, sound identifier, determinism and seeds, sample rates); one page
  per binding (web, Godot, Unity, C) with install and usage; reference
  (C ABI, conformance vectors and hash); contributing (spec-driven process,
  pull requests, local development) [L7.1].
- Site layout: documentation at `/`, playground at `/playground/` (Vite
  `base: '/playground/'`) [L7.2]. `npm run build:site` builds the web package,
  the playground and VitePress, and copies the playground into the VitePress
  output.
- VitePress fails the build on dead internal links [L7.3].
- Hosting (LQ7): organization `mumble-speech`, repository
  `mumble-speech/mumble-speech.github.io`, GitHub Pages from its `main`
  branch, URL `https://mumble-speech.github.io/` [L7.4]. The code stays on
  `basteez/mumble-speech`.
- CI job `site`: builds the site on every pull request (required check). On
  push to `main` it deploys the output to the organization repository with
  `peaceiris/actions-gh-pages` (`external_repository`), authenticated by an SSH
  deploy key with write access on that repository only; its private half is
  the `SITE_DEPLOY_KEY` secret of `basteez/mumble-speech`. A `.nojekyll` file
  disables Jekyll processing.
- One-time setup: the user creates the free organization (it cannot be created
  from the CLI); the rest is scripted with `gh`: the repository (Pages is enabled
  automatically for `<org>.github.io`, branch `main`, HTTPS), the org policy
  allowing deploy keys (new organizations disable them), the deploy key and the
  secret. Each deploy is a single orphan commit (`force_orphan`), so the site
  repository does not grow with history.

## 13. Release [L8]

`.github/workflows/release.yml`, on tags `v*.*.*`; manual runs and pull
requests that change the workflow or `scripts/release/` are dry runs (archives
built and verified, no GitHub Release):

1. `version`: the tag equals the version in `Cargo.toml` (workspace),
   `packages/web/package.json` and `bindings/unity/package.json` [L8.2].
2. `native` (Linux x64, Windows x64, macOS): release builds of `mumble-ffi`
   and `mumble-godot`; on macOS both architectures joined with `lipo`.
3. `web`: `@mumble-speech/web` build and `npm pack`.
4. `assemble`: from the artifacts of 2–3, with `LICENSE-MIT`, `LICENSE-APACHE`
   and the binding README in each archive:
   - `mumble-speech-c-X.Y.Z.zip`: `include/mumble.h`, `lib/<platform>/`
     (shared libraries, Windows import library);
   - `mumble-speech-godot-X.Y.Z.zip`: `addons/mumble_speech/` with `bin/` for
     the three platforms;
   - `com.mumble-speech.unity-X.Y.Z.tgz`: the UPM package (`package/` prefix,
     as npm tarballs) with `Plugins/` filled;
   - `mumble-speech-web-X.Y.Z.tgz`: the npm tarball;
   (`scripts/release/assemble.sh`).
5. `verify` (Linux, `scripts/release/verify.sh`): the C tests link against the
   packaged library; the packaged Godot addon passes the headless tests on
   Godot 4.3; the Unity tarball has the three plugins and a `.meta` for every
   file; the npm tarball installs in an empty project and renders a vector.
6. `notes` (`scripts/release/notes.mjs`) [L8.3, L8.4]: writes
   `SHA256SUMS.txt` next to the archives and composes the release notes from
   `CHANGELOG.md` (the version's section; on tags it must exist, dry runs fall
   back to *Unreleased*), the archives (size, SHA-256, download URLs) and
   repository metadata (`MUMBLE_ABI_VERSION` from `mumble.h`, vector format and
   count from `vectors.json`, `compatibility_minimum` from the `.gdextension`,
   `unity` from the Unity `package.json`, `engines.node` from the web
   `package.json`), plus a *Packages* table linking the version on npm,
   crates.io, docs.rs, the `upm` and `godot-addon` tags, and the OpenUPM and
   Godot Asset Library pages listed in `scripts/release/registries.json`
   (empty until those entries are approved). GitHub's generated notes (merged pull requests and compare
   link, from the `releases/generate-notes` API) are appended. The notes are
   shown in the run summary and uploaded as an artifact, so dry runs give a
   preview.
7. `publish` (tags only, after `verify` and `notes`): `gh release create vX.Y.Z
   --notes-file notes.md` with the four archives and `SHA256SUMS.txt` [L8.1].

`CHANGELOG.md` follows Keep a Changelog: `## [Unreleased]`, then
`## [X.Y.Z] - YYYY-MM-DD` sections with `### Added`, `### Changed`,
`### Fixed`, `### Removed` and `### Known issues`. The site includes it as the
*Changelog* page.

Prereleases (L8.5): the `version` job marks versions with a `-` suffix as
prereleases. Then `notes` does not require a changelog section, `publish` adds
`--prerelease`, `npm` publishes with `--tag next`, and `upm` / `godot-addon`
push only their tags (`publish-branch.sh --tag-only`): the commit sits on top
of the branch but the branch head stays on the last stable release.

Publishing a release is an outward-facing action: the first tag is pushed
only with the user's go-ahead.

### 13.1 Registries [L9] (LD16)

After `publish`, four independent jobs (L9.5), tags only:

| Job | Registry | How | One-time setup by the maintainer |
|---|---|---|---|
| `npm` | npm, `@mumble-speech/web` | `npm publish <release tarball> --access public --provenance`; token `NPM_TOKEN` if present, otherwise OIDC trusted publishing (`id-token: write`, npm ≥ 11.5.1) | npm account and organization `mumble-speech`; a short-lived granular token for the first publish; then trusted publisher (`basteez/mumble-speech`, `release.yml`) and token deleted |
| `crates` | crates.io, `mumble-speech` | `cargo publish -p mumble-speech`; token `CARGO_REGISTRY_TOKEN` if present, otherwise `rust-lang/crates-io-auth-action` (OIDC) | crates.io account (GitHub login, verified email); a scoped token for the first publish (crates.io requires it); then trusted publishing and token deleted |
| `upm` | git branch `upm` + OpenUPM | the package from the release tarball pushed as a new commit on `upm` (`package.json` at the root), tagged `upm/vX.Y.Z` | one-time submission on openupm.com (branch `upm`, tag prefix `upm/`) |
| `godot-addon` | git branch `godot-addon` + Godot Asset Library | the addon from the release zip pushed as a new commit on `godot-addon` (with `LICENSE` and README), tagged `godot/vX.Y.Z`; the run summary prints version, commit and URLs for the Asset Library form | Asset Library account and first submission; each release: edit the entry with the printed values |

Both branches keep one commit per release on top of the previous one, so every
tag stays reachable. Pull requests run `cargo publish --dry-run -p mumble-speech`
in the `core` job. The crate gets a README and the metadata crates.io and
docs.rs need (`repository`, `homepage`, `documentation`, `readme`, `keywords`,
`categories`). An icon (`docs/public/icon.png`, 256 × 256, also the site logo)
serves the Asset Library.

## 14. Risks

| Risk | Mitigation |
|---|---|
| WASM ↔ native bit-exactness | `libm` everywhere + vectors in CI on all platforms |
| macOS quarantine on downloaded `.dylib`s (Godot, Unity) | Document `xattr -d`; signing and notarization out of scope for v1 |
| `gdext` compatibility with Godot versions | Pin the minimum version (4.3) and test it in CI |
| WASM size | No `serde`, `opt-level = "z"`, `wasm-opt`, budget verified in CI |
| Unity not verifiable in CI | EditMode tests in the package + manual checklist |

## 15. Decision log

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| LD0 | Single core in Rust + bindings | Multiple ports; TS only | User's choice: a single implementation, identical output everywhere |
| LD1–LD5 | See §8 | | |
| LD6 | Godot via `gdext` on the core, not via the C ABI | C++ GDExtension on the C ABI | Less glue code, native Godot types, same language as the core |
| LD7 | Vector hash FNV-1a 64 | SHA-256 | Implementable in a few lines in C, C#, GDScript and TS |
| LD8 | Playground in a separate repository (superseded by LD9) | `apps/playground` in the monorepo | User request: the library repo contains only the library |
| LD9 | Playground back in the monorepo as a private app, with its history imported | Separate repository linked from the README | A contributor changing the core can hear it with one clone and one PR; CI catches API breaks in the same PR; no version drift between library and demo [L6.1] |
| LD10 | Benchmarks warm up once and scale their budget by `MUMBLE_PERF_SLACK` (1 locally, 3 in CI) | Exact budget in CI; no benchmark in CI | First CI run: 52 ms vs 50 ms (core, `beep`, cold first run) and 290 ms vs 250 ms (playground) on 2-core shared runners, while the same code passes on the laptop with margin. A ×3 slack still catches regressions like D6 (×30) |
| LD11 | Diacritic folding through generated tables (`FOLD`, `IGNORABLE`) instead of `unicode-normalization` at runtime | Keep `unicode-normalization`; hand-written Latin table | Measured: the normalization tables were 64 KB of the 104 KB gzip WASM, budget 60 KB (L4.2); without them 40 KB. Generated tables keep R1.4 exact, and an exhaustive test over all scalar values proves it; a hand-written table would drift |
| LD12 | WASM inlined as base64 in the JS module | Separate `.wasm` file loaded via `new URL(…, import.meta.url)` | Works unchanged in browsers, Node ≥ 20 and bundlers (a separate file needs `fs` in Node and bundler support, and `node:` imports break some bundlers). Measured: base64 costs 30% more gzip than the raw `.wasm` (51.8 KB vs 39.9 KB); the package totals 57.2 KB gzip, under the 60 KB budget [L4.2] with a narrow margin, guarded by the size test. If the budget is exceeded, switch to a separate `.wasm` file |
| LD13 | Unity package split into a `UnityEngine`-free interop assembly, verified in CI with plain .NET (C# 9), and thin Unity components verified manually | Everything verified manually | No Unity license in CI. Interop is where silent errors live (struct layout, marshalling, UTF-16 offsets); plain .NET runs the same C# against the real library on every PR |
| LD14 | Events carry a sound identifier (style + variant) instead of a dot (color + size); C ABI version 2 | Keep the dot; keep both | Colors are a presentation choice of the playground; a neutral identifier is useful to games (mouth shapes, effects) and keeps the library free of UI decisions (LQ6, user decision) |
| LD15 | Site on a dedicated free organization (`mumble-speech.github.io`), deployed from this repository with a deploy key | Pages on `basteez` (forced onto `bstz.it/mumble-speech` by the user site's custom domain); Cloudflare Pages; a `bstz.it` subdomain | GitHub applies the user site's custom domain to every project site of the account (documented behavior); an organization keeps a default `github.io` domain with no third-party account (LQ7, user decision) |
| LD16 | Registries: npm and crates.io from CI (token only for the first publish, then OIDC); Unity and Godot through generated git branches (`upm`, `godot-addon`) with the binaries, tracked by OpenUPM and the Asset Library | Commit binaries to `main`; store long-lived tokens; automate the Asset Library with the account password | OpenUPM and the Asset Library build from git commits, and the native libraries are not in `main`; generated branches keep `main` clean. npm and crates.io require the package to exist before trusted publishing can be configured |

Decisions inherited from the first version (IDs unchanged):

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| D3 | Sounds ≤ 0.9 slot | Overlaps allowed | No clipping from summing, simpler timeline |
| D4 | Vowel mapping from the English name of the letters, only for consonants (revised by D9) | Arbitrary mapping | Closer to Animalese, explainable rule |
| D5 | ×3 makeup on the formants | No compensation | A narrow band-pass lets through about one harmonic: without makeup `grunt` and `alphabet` are much quieter than `beep` |
| D6 | DSP synthesis in TypeScript (replaces the `OfflineAudioContext` graph) | `OfflineAudioContext` | Measured on Chrome: 1.4–9.5 s for 500 characters, because the nodes stay active for the whole duration (cost O(events × duration)), so it violated the playground's latency requirement (R5.4). Direct synthesis is linear, testable in Node and identical across browsers |
| D9 | `alphabet`: vowels with 3 cascaded formants, each vowel sounds as itself, nearly constant pitch | 2 narrow band-passes in parallel, vowels from the English name, ±6 semitones between letters | Listening feedback: it did not sound like Animal Crossing and the vowels were not recognizable (the `a` sounded like "e", the `i` sounded like "a"). Narrow band-passes whistle, the cascade gives believable vowels; the note jumps made the result sound like a melody |
