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

pub enum DotSize { Sm, Md, Lg }
pub struct Dot { pub rgb: u32, pub size: DotSize }        // 0xRRGGBB [L2.3]

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
    pub dot: Dot,
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
pub struct Utterance { pub samples: Vec<f32>, pub advance: f64, pub dot: Option<Dot> }
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

Core dependencies: `libm` (deterministic math [L1.4]), `unicode-segmentation`
(graphemes) and `unicode-normalization` (diacritic stripping, R1.4), all
`no_std`. Nothing else.

## 3. Cross-platform determinism [L1.4]

- All internal computations in `f64`, output converted to `f32` only at the end.
- Transcendental functions (`sin`, `cos`, `exp`, `pow`, `log2`) only from `libm`,
  never from `std` or from the system libm, which differ across platforms.
- Rust does not fuse operations into FMA automatically; `mul_add` is not used.
- No iteration over `HashMap`; tables are arrays.
- Sample positions with `libm`'s `round`.
- Verification: the same conformance vectors run on native (macOS, Windows,
  Linux) and on WASM in CI, comparing the PCM hash.

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
3. Iteration is per *grapheme* (`Intl.Segmenter`), so a composite emoji counts as a single token.

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
  sounding     → { sound, dot } = style.voice(token, rng, prev)
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
| Dot | color `--teal`, `md` |

No use of `rng` inside the style.

### 5.2 `grunt` [R3.2, R3.3]

Four fixed grunts: low-pass filtered `sawtooth` wave, downward glissando.

| # | Frequency | Glide | `durationRatio` | Formants | Dot |
|---|---|---|---|---|---|
| 0 | 140 Hz | −3 | 0.5 | 600 / 1000 | `--teal`, `sm` |
| 1 | 180 Hz | −5 | 0.75 | 700 / 1200 | `--blue`, `md` |
| 2 | 110 Hz | −2 | 0.9 | 500 / 900 | `--olive`, `lg` |
| 3 | 210 Hz | −6 | 0.6 | 800 / 1400 | `--orange`, `md` |

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
- dot: `hsl(round(n × 360 / 26), 55%, 55%)`, `md`.

The tuple (vowel, `o`, `centerHz`) is different for each letter; a test
verifies that the 26 `SoundSpec`s are all distinct [R3.4].

Digits and `other`: schwa, 240 Hz, same glide, no noise, gray dot
`--muted` [R3.5].

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
| LD3 | Dot color | CSS string (`var(--teal)`, `hsl(…)`) | `0xRRGGBB` | Platform-neutral. The CSS theme colors become: teal `0x3f8f78`, blue `0x3f6fc4`, olive `0x7d8f45`, orange `0xb85a33`, muted `0x9aa0a6`; `hsl(h 55% 55%)` is converted to RGB. |
| LD4 | Default sample rate | 44,100 | 48,000 | Default of Unity and of modern devices. |
| LD5 | Implementation | TypeScript (in the playground) | Rust | A single implementation [L1.1]. The Vitest tests of the TS core become Rust tests and conformance vectors. |

## 9. Bindings

### 9.1 Web: `mumble-wasm` + `@mumble-speech/web` [L4.1, L4.2]

- `wasm-bindgen` (pinned version) with `--target web`, build with
  `opt-level = "z"`, LTO and `wasm-opt -Oz`.
- Objects cross the boundary in compact form: samples as
  `Float32Array`, events as a packed `Float64Array`. The TS wrapper
  turns them into typed objects. No `serde`, for size [L4.2].
- TS API:

```ts
await init();                        // loads the WASM, idempotent
render(text, voice, sampleRate?) → { samples: Float32Array; timeline: Timeline }
timeline(text, voice) → Timeline
encodeWav(samples, sampleRate) → Uint8Array
new Speaker(voice, sampleRate?)  .next(text) → Utterance  .reset()  .free()
new WebAudioPlayer()  .unlock()  .play(samples, sampleRate)  .stop()  .position()
```

- `WebAudioPlayer` is the playground's `Player`, moved into the package.
- Tests: Vitest in Node loads the WASM and runs the vectors [L5.2]. An external consumption check runs `npm pack`, installs the tarball in an empty project and uses the public API [L6.2].

### 9.2 C ABI: `mumble-ffi` [L4.3–L4.5]

```c
uint32_t mumble_abi_version(void);

typedef struct { uint32_t style; double pitch, speed, variation; uint32_t seed; } MumbleVoice;
typedef struct { uint32_t grapheme_index, utf8_start, utf8_len, utf16_start, utf16_len;
                 double start, duration; uint32_t dot_rgb; uint8_t dot_size; } MumbleEvent;

typedef struct MumbleRender MumbleRender;   // opaque, owned by the caller
int32_t mumble_render(const char *utf8, size_t len, const MumbleVoice *v,
                      uint32_t sample_rate, MumbleRender **out);
const float *mumble_render_samples(const MumbleRender *r, size_t *len);  // valid until free
size_t mumble_render_event_count(const MumbleRender *r);
int32_t mumble_render_event(const MumbleRender *r, size_t i, MumbleEvent *out);
void mumble_render_free(MumbleRender *r);

typedef struct MumbleSpeaker MumbleSpeaker;
MumbleSpeaker *mumble_speaker_new(const MumbleVoice *v, uint32_t sample_rate);
int32_t mumble_speaker_next(MumbleSpeaker *s, const char *utf8, size_t len,
                            const float **samples, size_t *count,   // valid until the next call
                            double *advance, uint32_t *dot_rgb, uint8_t *dot_size);
void mumble_speaker_reset(MumbleSpeaker *s);
void mumble_speaker_free(MumbleSpeaker *s);

int32_t mumble_encode_wav(const float *samples, size_t len, uint32_t sample_rate,
                          uint8_t **out, size_t *out_len);
void mumble_bytes_free(uint8_t *p, size_t len);
```

- Codes: `0` ok, `<0` error (`-1` null argument, `-2` invalid UTF-8,
  `-3` voice out of range, `-99` panic caught with `catch_unwind`) [L4.4].
- Header generated by `cbindgen` at build time and committed in `bindings/c/`.
- Tests: C program (CMake + CTest) that runs a subset of the vectors,
  embedded as a header generated by the conformance crate.

### 9.3 Godot: `mumble-godot` [L4.6]

- GDExtension written in Rust with `gdext`, which uses the core directly (not
  the C ABI): one fewer layer, native Godot types.
- Classes:
  - `MumbleVoice` (`Resource`): `style`, `pitch`, `speed`, `variation`, `seed`, editable from the inspector.
  - `MumbleSpeaker` (`Node`): `voice`, `bus`; `say(text)`, `speak_character(c)`, `stop()`, `render_stream(text) → AudioStreamWAV`; signals `character_spoken(index)` and `finished`. Internally it uses an `AudioStreamPlayer`.
  - `MumbleTypewriter` (`Node`): `label: NodePath`, `speaker: NodePath`; `type_text(text)` sets the text, reveals one character at a time with `visible_characters` using the advances and plays each character; signal `finished`.
- Distribution: `bindings/godot/addons/mumble_speech/` with the
  `.gdextension` file and the per-platform binaries in `bin/`.
- Tests: Godot test project run in CI with `godot --headless`, which
  verifies the vectors via `MumbleSpeaker.render_stream` and the typewriter's behavior.

### 9.4 Unity [L4.7]

- Package `com.mumble-speech.unity`:
  - `Runtime/Native.cs`: `[DllImport("mumble_ffi")]` over the C ABI.
  - `Runtime/MumbleVoice.cs` (`ScriptableObject`).
  - `Runtime/MumbleSpeaker.cs` (`MonoBehaviour` with `AudioSource`): `Say(string)` creates an `AudioClip` with `AudioClip.Create` + `SetData`; `SpeakCharacter(string)`; events `OnCharacter(int)` and `OnFinished`.
  - `Runtime/TMP/MumbleTypewriterTMP.cs` in a separate assembly, compiled only if `com.unity.textmeshpro` is present (`versionDefines`). Uses `maxVisibleCharacters` and the advances.
  - `Plugins/{macOS,Windows,Linux}/`: C ABI binaries.
  - `Samples~/Basic`: example scene [L4.9].
  - `Tests/EditMode`: execution of the vectors [L5.2].
- Verification: manual, because a Unity license in CI is not available.

## 10. Build and CI [L4.3, L5.2]

GitHub Actions, matrix:

| Job | Runner | Produces / verifies |
|---|---|---|
| core | ubuntu, macos, windows | `cargo test`, native vectors, L2.5 benchmark |
| wasm | ubuntu | WASM build, package Vitest tests, L4.2 budget, L6.2 external consumption |
| ffi | ubuntu, macos, windows | native library (macOS universal with `lipo`), CTest tests |
| godot | ubuntu | GDExtension build, headless tests |
| playground | ubuntu | build and tests of `apps/playground` against the workspace package [L6.1] |

Performance budgets (L2.5, playground R5.4) are defined for a mid-range laptop.
Shared CI runners are slower and noisy, so CI sets `MUMBLE_PERF_SLACK=3`: the
benchmarks still run (after a warm-up) and fail on order-of-magnitude
regressions, while the exact budget is checked locally, where the slack
defaults to 1 (LD10).
| release | on tag | artifacts: Godot addon zip, Unity package, npm tarball, C archive |

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

## 12. Risks

| Risk | Mitigation |
|---|---|
| WASM ↔ native bit-exactness | `libm` everywhere + vectors in CI on all platforms |
| macOS quarantine on downloaded `.dylib`s (Godot, Unity) | Document `xattr -d`; signing and notarization out of scope for v1 |
| `gdext` compatibility with Godot versions | Pin the minimum version (4.3) and test it in CI |
| WASM size | No `serde`, `opt-level = "z"`, `wasm-opt`, budget verified in CI |
| Unity not verifiable in CI | EditMode tests in the package + manual checklist |

## 13. Decision log

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| LD0 | Single core in Rust + bindings | Multiple ports; TS only | User's choice: a single implementation, identical output everywhere |
| LD1–LD5 | See §8 | | |
| LD6 | Godot via `gdext` on the core, not via the C ABI | C++ GDExtension on the C ABI | Less glue code, native Godot types, same language as the core |
| LD7 | Vector hash FNV-1a 64 | SHA-256 | Implementable in a few lines in C, C#, GDScript and TS |
| LD8 | Playground in a separate repository (superseded by LD9) | `apps/playground` in the monorepo | User request: the library repo contains only the library |
| LD9 | Playground back in the monorepo as a private app, with its history imported | Separate repository linked from the README | A contributor changing the core can hear it with one clone and one PR; CI catches API breaks in the same PR; no version drift between library and demo [L6.1] |
| LD10 | Benchmarks warm up once and scale their budget by `MUMBLE_PERF_SLACK` (1 locally, 3 in CI) | Exact budget in CI; no benchmark in CI | First CI run: 52 ms vs 50 ms (core, `beep`, cold first run) and 290 ms vs 250 ms (playground) on 2-core shared runners, while the same code passes on the laptop with margin. A ×3 slack still catches regressions like D6 (×30) |

Decisions inherited from the first version (IDs unchanged):

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| D3 | Sounds ≤ 0.9 slot | Overlaps allowed | No clipping from summing, simpler timeline |
| D4 | Vowel mapping from the English name of the letters, only for consonants (revised by D9) | Arbitrary mapping | Closer to Animalese, explainable rule |
| D5 | ×3 makeup on the formants | No compensation | A narrow band-pass lets through about one harmonic: without makeup `grunt` and `alphabet` are much quieter than `beep` |
| D6 | DSP synthesis in TypeScript (replaces the `OfflineAudioContext` graph) | `OfflineAudioContext` | Measured on Chrome: 1.4–9.5 s for 500 characters, because the nodes stay active for the whole duration (cost O(events × duration)), so it violated the playground's latency requirement (R5.4). Direct synthesis is linear, testable in Node and identical across browsers |
| D9 | `alphabet`: vowels with 3 cascaded formants, each vowel sounds as itself, nearly constant pitch | 2 narrow band-passes in parallel, vowels from the English name, ±6 semitones between letters | Listening feedback: it did not sound like Animal Crossing and the vowels were not recognizable (the `a` sounded like "e", the `i` sounded like "a"). Narrow band-passes whistle, the cascade gives believable vowels; the note jumps made the result sound like a melody |
