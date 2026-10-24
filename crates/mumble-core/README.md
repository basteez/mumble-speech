# mumble-speech

Video-game "mumble speech" generated at runtime: turn a line of text into the babble
that game characters speak, in three styles — `Beep` (Undertale), `Grunt`
(Banjo-Kazooie) and `Alphabet` (Animal Crossing).

`no_std` (with `alloc`), deterministic: the same input gives the same samples, bit for
bit, on every platform and in WebAssembly. This crate is the core behind the web, Godot,
Unity and C bindings of [mumble-speech](https://github.com/basteez/mumble-speech).

```rust
use mumble_speech::{render, Speaker, StyleId, Voice};

let voice = Voice { pitch: 2.0, ..Voice::new(StyleId::Alphabet) };

// A whole line: mono samples plus a timeline of events (start, duration,
// position in the text, sound identifier).
let line = render("Hello!", &voice, 48_000)?;

// Typewriter dialogue: one character at a time, with the seconds to wait
// before the next one.
let mut speaker = Speaker::new(voice, 48_000)?;
let h = speaker.next("H");
```

- Voice: style, pitch (−12…+12 semitones), speed (5–30 characters per second),
  variation (0–1), seed.
- `encode_wav` turns samples into a 16-bit PCM WAV file.
- Documentation and playground: <https://mumble-speech.github.io/>.

Licensed under either of MIT or Apache-2.0, at your option.
