# Changelog

All notable changes to mumble-speech are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Every pull request that changes behavior
or public API adds an entry to *Unreleased*.

## [Unreleased]

### Changed

- Release notes link the release on every registry (npm, crates.io, docs.rs, the Unity
  and Godot branches).
- Tags with a suffix such as `v0.2.0-rc.1` are published as prereleases: npm dist-tag
  `next`, a crates.io prerelease, and the Unity and Godot branches stay on the last
  stable release.
- Publishing to npm and crates.io uses trusted publishing (OIDC): no tokens are stored.

## [0.1.0] - 2026-10-24

First release: one Rust core that turns text into video-game mumble speech, with
bindings for the web, Godot, Unity and C.

### Added

- **Three styles**: `beep` (one beep per letter, like Undertale), `grunt` (four
  grunts per voice, never the same twice in a row, like Banjo-Kazooie) and
  `alphabet` (a vowel-based sound for every letter, Italian vowels, like Animal
  Crossing).
- **Voice**: pitch (−12…+12 semitones), speed (5–30 characters per second),
  variation (0–1) and seed; invalid values are rejected with typed errors.
- **Two ways to use it**: render a whole line (samples plus a timeline of events
  with start, duration, position in the text and sound identifier), or a typewriter
  speaker that returns one character's sound and how long to wait before the next.
  Both give the same samples, bit for bit.
- **Sound identifier** on every event (style and variant: which grunt, which letter,
  or the neutral sound), so hosts can drive mouth shapes or effects. Nothing is drawn
  by the library.
- **Determinism**: same input, same samples on Linux, Windows, macOS (Apple Silicon
  and Intel) and WebAssembly, checked in CI by 34 shared conformance vectors through
  every binding.
- **Web**: `@mumble-speech/web`, WebAssembly inlined (works in browsers and Node ≥ 20
  with any bundler, about 57 KB gzip), TypeScript API, `WebAudioPlayer`, WAV export.
- **Godot 4.3+**: GDExtension addon with `MumbleVoice`, `MumbleSpeaker`
  (`say`, `speak_character`, signals on the audio clock) and `MumbleTypewriter` for
  `Label`/`RichTextLabel`; Windows x64, macOS universal, Linux x64.
- **Unity 2022.3+**: UPM package with `MumbleVoice`, `MumbleSpeaker`, an optional
  TextMeshPro typewriter, a sample, EditMode tests, and a `UnityEngine`-free C# API;
  Windows x64, macOS universal, Linux x64.
- **C ABI** (version 2): `mumble.h` with render, events, typewriter speaker and WAV
  encoding; status codes, no panics across the boundary; shared libraries for
  Windows x64, macOS universal and Linux x64.
- **Documentation and playground** at https://mumble-speech.github.io/.
- **Distribution**: npm (`@mumble-speech/web`), crates.io (`mumble-speech`), Unity by
  git URL (branch `upm`), Godot addon on branch `godot-addon`, and release archives
  with checksums.

### Known issues

- The Unity components, sample and TextMeshPro typewriter have not been checked in
  the Unity editor yet (the C# interop layer is tested in CI); please report problems.
- macOS may quarantine libraries downloaded from the browser. If Godot or Unity cannot
  load them, run `xattr -dr com.apple.quarantine` on the extracted folder.
- Desktop only: no prebuilt libraries for iOS, Android or consoles, no Godot web export
  or Unity WebGL support yet.
- The OpenUPM and Godot Asset Library entries are submitted after this release and
  appear once approved; until then use the git URL (Unity) or the release zip (Godot).

[Unreleased]: https://github.com/basteez/mumble-speech/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/basteez/mumble-speech/releases/tag/v0.1.0
