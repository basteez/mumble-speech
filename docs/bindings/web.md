# Web (npm)

`@mumble-speech/web`: the Rust core compiled to WebAssembly, with a TypeScript API.
Works in the latest two versions of Chrome, Firefox and Safari (desktop and iOS) and in
Node ≥ 20, with any bundler: the WebAssembly module is inlined, so there is no file to
serve. About 57 KB gzip.

## Install

Not on npm yet. Build it from the repository (needs Rust with the
`wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.129):

```sh
npm install
npm run build -w @mumble-speech/web
npm pack -w @mumble-speech/web      # mumble-speech-web-0.1.0.tgz, installable anywhere
```

## Use

```ts
import { init, render, Speaker, WebAudioPlayer, encodeWav } from '@mumble-speech/web';

await init(); // once, before anything else

// A whole line.
const { samples, sampleRate, timeline } = render('Hello, world!', { style: 'alphabet', pitch: 2 });

const player = new WebAudioPlayer();
button.onclick = async () => {
  player.unlock(); // synchronously inside the user gesture (autoplay policies)
  await player.play(samples, sampleRate);
};
// player.position() → seconds heard so far, compensated for output latency.

// Typewriter dialogue.
const speaker = new Speaker({ style: 'grunt', seed: 42 });
for (const ch of 'Guh-huh!') {
  const { samples, advance, sound } = speaker.next(ch);
  // play samples, wait `advance` seconds, use `sound` (or not)
}
speaker.free(); // releases WebAssembly memory

// Download as WAV.
const wav = encodeWav(samples, sampleRate); // Uint8Array
```

## API

| Export | Description |
|---|---|
| `init()` | Instantiates the WebAssembly module. Idempotent. Every other call throws before it resolves. |
| `render(text, voice, sampleRate = 48000)` | `{ samples: Float32Array, sampleRate, timeline }` |
| `timeline(text, voice)` | `{ events, duration }` without synthesizing audio. |
| `encodeWav(samples, sampleRate)` | 16-bit PCM mono WAV file as `Uint8Array`. |
| `new Speaker(voice, sampleRate = 48000)` | `.next(text) → { samples, advance, sound }`, `.reset()`, `.free()` |
| `new WebAudioPlayer()` | `.unlock()`, `.play(samples, sampleRate)`, `.stop()`, `.position()` |
| `MumbleError` | Thrown for invalid input; `.code` is `PitchOutOfRange`, `SpeedOutOfRange`, `VariationOutOfRange`, `SampleRateOutOfRange` or `UnknownStyle`. |

`Voice` is `{ style, pitch?, speed?, variation?, seed? }` (see
[Concepts](/guide/concepts#voice)). Each event has `start`, `duration`,
`graphemeIndex`, `utf8Start`/`utf8Length`, `utf16Start`/`utf16Length` (index JavaScript
strings with these) and `sound: { style, variant }`.
