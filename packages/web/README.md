# @mumble-speech/web

Video-game "mumble speech" for the web: turn a line of text into the babble that
game characters speak, in three styles — `beep` (Undertale), `grunt`
(Banjo-Kazooie) and `alphabet` (Animal Crossing).

WebAssembly build of the [mumble-speech](https://github.com/basteez/mumble-speech)
Rust core: same output, bit for bit, as the native, Godot and Unity bindings.
Works in browsers and Node ≥ 20, with any bundler (the module is inlined).

> Early development, not published to npm yet.

## Usage

```ts
import { init, render, Speaker, WebAudioPlayer, encodeWav } from '@mumble-speech/web';

await init();

// A whole line: samples plus a timeline to sync text with sound.
const { samples, sampleRate, timeline } = render('Hello, world!', { style: 'alphabet', pitch: 2 });
const player = new WebAudioPlayer();
player.unlock(); // inside a click handler
await player.play(samples, sampleRate);

// Typewriter dialogue: one character at a time.
const speaker = new Speaker({ style: 'grunt', seed: 42 });
for (const ch of 'Guh-huh!') {
  const { samples, advance } = speaker.next(ch); // play `samples`, wait `advance` seconds
}
speaker.free();

// Download as WAV.
const wav = encodeWav(samples, sampleRate);
```

Voice: `style`, `pitch` (−12..12 semitones, default 0), `speed` (5..30 characters/s,
default 15), `variation` (0..1, default 0), `seed` (default 0). Invalid values throw a
`MumbleError` with a `code`.

Each timeline event has `start`/`duration` (seconds), `utf16Start`/`utf16Length` (index
your JavaScript string with them) and `sound: { style, variant }`: which sound plays
(`grunt` 0–3, `alphabet` 0–25 for a–z, 26 neutral, `beep` 0). Map it to whatever you
like — mouth shapes, particles, colors. Nothing is drawn by the package.

## License

MIT OR Apache-2.0.
