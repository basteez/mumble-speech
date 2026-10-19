# Requirements

Status: **approved on 2026-10-19.**

## 1. Goal

Generate "mumble speech" (the fake speech of video games) in three styles with
a library that has **a single implementation in Rust**, usable:

- on the web, via WebAssembly and an npm package;
- in Godot 4, via a GDExtension addon;
- in Unity, via a UPM package with a native library;
- from any other language, via a C interface (C ABI).

The test web page (*playground*) is a separate project,
`mumble-speech-playground`, which uses the library only through the npm package
(L6).

## 2. Glossary

| Term | Meaning |
|---|---|
| **Style** | Algorithm that decides which sound to associate with each character. In v1: `beep`, `grunt`, `alphabet`. |
| **Sounding character** | Character that produces a sound: letter, digit or other symbol not classified as space or punctuation. |
| **Pause** | Silence produced by spaces, punctuation and newlines. |
| **Slot** | Base time unit: `1 / speed` seconds. Each character occupies one or more slots. |
| **Timeline** | Ordered sequence of sound events computed from the text. It is identical for playback, visualization and export. |
| **Core** | The Rust crate with all the logic: tokenization, styles, timeline, synthesis, WAV. |
| **Binding** | Thin layer that exposes the core to a platform (WASM/npm, C ABI, Godot, Unity). No mumble speech logic. |
| **Voice** | Style + pitch + speed + variation + seed. |
| **Render** | Audio of an entire text, plus its timeline. |
| **Speaker** | Stateful object that produces the sound of one character at a time (typewriter mode). |
| **Advance** | Seconds to wait after a character before the next one (1 slot, 2 or 4 for pauses). |
| **Conformance vector** | Shared test case (input → expected timeline + PCM hash) that every binding must pass. |

## 3. Styles

| ID | UI name | Rule | Reference |
|---|---|---|---|
| `beep` | One beep per letter | The same beep for every sounding character. | Undertale |
| `grunt` | A few grunts per character | The voice has a small set of grunts; each sounding character plays one of them. | Banjo-Kazooie |
| `alphabet` | A sound for every letter | Each of the 26 letters has its own recognizable sound. | Animal Crossing |

## 4. Requirements

EARS format. **[auto]** = automated test in CI, **[man]** = manual
verification, **[rev]** = verification in code review.

### L1 — Core

- **L1.1** All mumble speech logic SHALL live in the Rust core. The bindings SHALL NOT reimplement any part of it. [rev]
- **L1.2** The core SHALL implement the R behaviors (next section). [auto]
- **L1.3** The core SHALL compile both for `wasm32-unknown-unknown` and for native targets, without I/O, threads or clocks. [auto]
- **L1.4** Given the same input, the PCM produced SHALL be bit-for-bit identical on all supported platforms and in WASM. [auto]
- **L1.5** The sample rate SHALL be configurable between 8,000 and 192,000 Hz, with default 48,000. [auto]
- **L1.6** The `Voice` SHALL include an integer `seed` (default 0). Given the same style, voice and seed, the sequence of sounds SHALL depend only on the characters, not on the text that follows. [auto]
- **L1.7** The core SHALL reject an out-of-range voice: pitch from −12 to +12 semitones, speed from 5 to 30 characters/s, variation from 0 to 1. [auto]

### R — Behavior

These IDs come from the first version of the page and remain unchanged, so
existing tests and commits continue to refer to them.

- **R1.4** The system SHALL treat accented letters as the base letter (`è` → `e`, `ñ` → `n`). [auto]
- **R1.5** The system SHALL classify each character into exactly one category: `letter`, `digit`, `space`, `pause-short` (`, ; :`), `pause-long` (`. ! ? …` and newline), `other`. [auto]
- **R3.1** (`beep`) Every sounding character SHALL produce the same sound; with variation = 0 all events SHALL have identical frequency. [auto]
- **R3.2** (`grunt`) The voice SHALL have exactly 4 grunts distinct in pitch, duration and timbre. [auto]
- **R3.3** (`grunt`) Every sounding character SHALL play one of the 4 grunts, chosen in a pseudo-random but deterministic way, and TWO consecutive sounding characters SHALL NOT use the same grunt. [auto]
- **R3.4** (`alphabet`) Each of the 26 letters SHALL have a sound different from all the others, and the same letter SHALL always produce the same sound (at variation = 0). [auto]
- **R3.5** (`alphabet`) Digits and `other` characters SHALL produce a single common neutral sound. [auto]
- **R3.6** (all) Spaces SHALL produce 1 slot of silence, `pause-short` 2 slots, `pause-long` 4 slots. [auto]
- **R3.7** (all) No sound SHALL exceed its own slot: events do not overlap. [auto]
- **R3.8** (all) Given the same text and voice (seed included), the timeline SHALL be identical across different runs (determinism). The seed is explicit, not derived from the text (LD1). [auto]
- **R3.9** (`alphabet`) The letters `a e i o u` SHALL sound like the corresponding Italian vowels: the spectrum of each SHALL be closer to the formants of its own vowel than to those of the other four. [auto] [man]
- **R3.10** (`alphabet`) The base pitch SHALL vary by at most ±1 semitone between different letters: what distinguishes the letters is the timbre, not the note. [auto]
- **R4.2** The pitch SHALL transpose all of the style's frequencies by `2^(semitones/12)`. [auto]
- **R4.3** The variation SHALL add to each event a random (deterministic) pitch offset in the range `±variation × 2` semitones. [auto]
- **R5.5** The core SHALL NOT produce clipping: all samples SHALL stay within `[−1, 1]`. [auto]
- **R7.1** `encodeWav` SHALL produce a 16-bit PCM, mono WAV file, at the requested sample rate. [auto]
- **R7.4** The render duration SHALL be the end of the last sound plus 50 ms of tail; trailing pauses are excluded. [auto]

### L2 — "Whole sentence" API

- **L2.1** The core SHALL offer `render(text, voice, sampleRate)`, which returns the mono `f32` PCM and the timeline. [auto]
- **L2.2** The core SHALL offer `timeline(text, voice)` without synthesizing audio. [auto]
- **L2.3** Each timeline event SHALL report: grapheme index, UTF-8 byte range, UTF-16 unit range, start, duration, dot color (sRGB `#rrggbb`) and size (`sm`/`md`/`lg`). [auto]
- **L2.4** The core SHALL offer `encodeWav(pcm, sampleRate)`, which produces a 16-bit mono PCM WAV. [auto]
- **L2.5** `render` on 500 characters at speed 5 SHALL take less than 50 ms natively and less than 150 ms in WASM, on a mid-range laptop. [auto]

### L3 — "Character by character" API (Speaker)

- **L3.1** The core SHALL offer a `Speaker` created from `voice` and `sampleRate`, with `next(grapheme)` returning: samples (empty for spaces and pauses), advance in seconds, dot (absent for spaces and pauses). [auto]
- **L3.2** If the samples returned by `next` for each grapheme of a text are placed at the respective cumulative advances, the result SHALL be bit-for-bit identical to `render` of the same text. [auto]
- **L3.3** IF `next` receives a string with multiple graphemes, it SHALL process them in order and return concatenated sounds and the total advance. [auto]
- **L3.4** `reset()` SHALL return the Speaker to its initial state. [auto]

### L4 — Bindings

- **L4.1** (Web) An npm package `@mumble-speech/web`, ESM with TypeScript types, SHALL expose L2 and L3 and a `WebAudioPlayer` helper. It SHALL work in the latest 2 versions of Chrome, Firefox, desktop Safari and iOS Safari, and in Node ≥ 20. [auto]
- **L4.2** (Web) The package, WASM included, SHALL weigh less than 60 KB gzip. [auto]
- **L4.3** (C ABI) The library SHALL provide an automatically generated `mumble.h` header and prebuilt libraries for macOS (universal arm64 + x86_64), Windows x64 and Linux x64. [auto]
- **L4.4** (C ABI) No function SHALL propagate a panic across the C boundary: errors SHALL be return codes. The ownership of every pointer SHALL be documented in the header. [auto] [rev]
- **L4.5** (C ABI) The header SHALL expose `mumble_abi_version()`. An incompatible change SHALL increment the version. [rev]
- **L4.6** (Godot) An addon for Godot ≥ 4.3 SHALL offer a `MumbleVoice` resource configurable from the inspector, a `MumbleSpeaker` node that plays sentences or single characters, and a `MumbleTypewriter` node that reveals a `Label` or `RichTextLabel` character by character synchronized with the audio. Platforms: desktop (Windows, macOS, Linux). [auto] [man]
- **L4.7** (Unity) A UPM package for Unity ≥ 2022.3 LTS SHALL offer a `MumbleVoice` `ScriptableObject`, a `MumbleSpeaker` component (`Say`, `SpeakCharacter`, per-character and end-of-sentence events) and a typewriter helper for `TMP_Text`, optional if TextMeshPro is present. Platforms: desktop. [man]
- **L4.8** Every binding SHALL use the same concepts (Voice, render, timeline, Speaker, advance) with names adapted to the platform's conventions. [rev]
- **L4.9** Every binding SHALL include a minimal runnable example. [man]

### L5 — Conformance and quality

- **L5.1** The repository SHALL contain at least 30 conformance vectors (styles, voices, seeds, sample rates, edge-case texts). The PCM hash is 64-bit FNV-1a over the little-endian `f32` bytes, easy to implement in any language. [auto]
- **L5.2** The test suites of core, Web, C ABI and Godot SHALL pass all vectors in CI. The Unity one SHALL pass them in a manual run (in CI it would require a Unity license). [auto] [man]
- **L5.3** All packages SHALL share the same semver version. [rev]

### L6 — Use from external projects

- **L6.1** The library repository SHALL NOT contain the playground or other demo apps beyond the minimal examples of L4.9. [rev]
- **L6.2** The `@mumble-speech/web` package SHALL be installable by an external project before publication, as a tarball (`npm pack`) or `file:` dependency. A CI check installs the tarball in an empty project and uses its public API. [auto]

## 5. Out of scope (v1)

- Prebuilt libraries for iOS, Android and consoles (the C ABI makes them possible later).
- Godot web export with GDExtension and Unity WebGL.
- Dedicated Unreal plugin (usable via the C ABI, without a wrapper).
- Custom or data-defined styles.
- Streaming synthesis in the audio thread.
- Publication to registries (npm, Godot Asset Library, OpenUPM).

## 6. Resolved questions

Closed with the proposed defaults, approved together with the specs on 2026-10-19.

| # | Question | Decision |
|---|---|---|
| LQ1 | Package names (`@mumble-speech/web`, `com.mumble-speech.unity`, crate `mumble-speech`)? | These, subject to an availability check. |
| LQ2 | License? | MIT OR Apache-2.0, Rust convention. |
| LQ3 | Hosting and CI? | GitHub + GitHub Actions. Git needs to be initialized and the repo created. |
| LQ4 | The seed change (L1.6) slightly changes the behavior of R3.8: the seed is no longer derived from the text. Is that OK? | Yes: it is necessary for L3.2. |
| LQ5 | Where does the playground live? | In a separate project, `mumble-speech-playground` (user request, 2026-10-19). |
