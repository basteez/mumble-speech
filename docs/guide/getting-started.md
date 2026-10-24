# Getting started

mumble-speech turns a line of text into the fake speech of video games. You choose a
**style** and a **voice**, and you get mono audio samples plus a **timeline** that says
when each character sounds, so you can reveal the text in sync.

::: warning Early development
Nothing is published to npm, the Godot Asset Library or OpenUPM yet. Each binding is
built from source for now; see its page.
:::

## Pick your platform

| Platform | Package | Page |
|---|---|---|
| Web (browser, Node ≥ 20) | `@mumble-speech/web` (WebAssembly) | [Web](/bindings/web) |
| Godot 4.3+ | GDExtension addon `addons/mumble_speech` | [Godot](/bindings/godot) |
| Unity 2022.3+ | UPM package `com.mumble-speech.unity` | [Unity](/bindings/unity) |
| C, C++, C#, Python, Unreal… | `mumble.h` + shared library | [C ABI](/bindings/c) |

## Two ways to use it

**A whole line.** Render the text once, play the audio, and use the timeline to
highlight or reveal characters:

```ts
import { init, render } from '@mumble-speech/web';

await init();
const { samples, sampleRate, timeline } = render('Hello there!', { style: 'alphabet' });
// timeline.events[i].start / .duration / .utf16Start …
```

**Typewriter.** Ask for one character at a time: you get its sound and how many
seconds to wait before the next one. This is what dialogue boxes in games do:

```ts
import { init, Speaker } from '@mumble-speech/web';

await init();
const speaker = new Speaker({ style: 'grunt', seed: 7 });
const { samples, advance } = speaker.next('G'); // play samples, wait `advance` seconds
speaker.free();
```

Both give exactly the same audio: placing each character's sound after the previous
advances reproduces the whole-line render bit for bit.

## Try it

The [playground](/playground/){target="_self"} runs the web package in your browser: type a line, pick a
style, tweak the voice and export a WAV.

## Next

- [Styles](./styles): what each style sounds like and how it is built.
- [Concepts](./concepts): voice, timeline, advance, sound identifier, determinism.
