# Godot

A GDExtension addon for **Godot 4.3 and later** on Windows, macOS, Linux and the
[web](#web-export). Audio is generated at runtime; nothing is drawn by the addon.

## Install

From the [Godot Asset Library](https://godotengine.org/asset-library/asset/5553): in
the editor, open the **AssetLib** tab, search for *Mumble Speech* and install it.

Or download `mumble-speech-godot-X.Y.Z.zip` from the
[latest release](https://github.com/basteez/mumble-speech/releases/latest) and unzip it
into your project, so that `addons/mumble_speech/` sits at its root. The same addon is
on the [`godot-addon`](https://github.com/basteez/mumble-speech/tree/godot-addon)
branch, which is what the Asset Library entry points to.

To build from source (needs Rust): `bindings/godot/build.sh`. For the web library, see
[Web export](#web-export).

## Use

```gdscript
var voice := MumbleVoice.new()          # or create one in the inspector
voice.style = MumbleVoice.ALPHABET
voice.pitch = 2.0

$MumbleSpeaker.voice = voice
$MumbleSpeaker.character_spoken.connect(func(i): print("now: ", i))
$MumbleSpeaker.say("Hello there!")

# Typewriter dialogue: reveals a Label or RichTextLabel in sync with the voice.
$MumbleTypewriter.label = $Label.get_path()
$MumbleTypewriter.speaker = $MumbleSpeaker.get_path()
$MumbleTypewriter.type_text("Guh-huh! Did you bring the honey?")
```

## Classes

| Class | Members |
|---|---|
| `MumbleVoice` (Resource) | `style` (`BEEP`, `GRUNT`, `ALPHABET`), `pitch`, `speed`, `variation`, `seed` |
| `MumbleSpeaker` (Node) | `voice`, `bus`, `volume_db`; `say(text)`, `speak_character(text) → float` (seconds to wait), `reset()`, `stop()`, `is_speaking()`, `render_stream(text) → AudioStreamWAV`; signals `character_spoken(char_index)`, `finished` |
| `MumbleTypewriter` (Node) | `label`, `speaker`; `type_text(text)`, `skip()`, `is_typing()`; signal `finished` |
| `Mumble` (static) | `render(text, voice, sample_rate) → { samples, duration, events }` (or `{ error }`), `encode_wav(samples, sample_rate)` |

Indices are code point indices of the Godot `String`, which is how
`visible_characters` counts. `Mumble.render` events carry `style` and `variant`.

`MumbleSpeaker` always synthesizes at `MumbleSpeaker.SAMPLE_RATE` (48,000 Hz), whatever
the output rate of the device, and Godot resamples the stream on playback; nothing is
resampled on a 48 kHz output. A line therefore gives the same samples on every machine
(bit-identity holds for the same text, voice and sample rate; what the player hears is
identical up to Godot's resampler, which the library does not control).
`render_stream` returns a 16-bit stream at that rate. For another rate, call
`Mumble.render` with an explicit `sample_rate`.

`character_spoken` and `finished` follow the audio clock (playback position, time since
the last mix, output latency), so they match what the player hears. On the web, in the
default *Sample* playback mode, they follow the time since the line started instead
([Web export](#web-export)).

## Web export

The addon includes two WebAssembly libraries, one for exports without threads
(`addons/mumble_speech/bin/mumble_godot.wasm`) and one for exports with threads
(`mumble_godot.threads.wasm`), so `Mumble`, `MumbleVoice`, `MumbleSpeaker` and
`MumbleTypewriter` work in a web export with the same API and the same samples as on
desktop. Godot picks the library that matches the export's **Thread Support** setting and
copies only that one next to `index.html`, so a player downloads one of them. Export
settings (**Project → Export… → Add… → Web**):

- **Godot 4.3 or later.** Earlier versions only export the web with threads and are not
  supported.
- **Extensions Support: on.** The web export then uses the `dlink` export templates,
  which are part of the official export template package (nothing extra to download).
- **Thread Support: off or on.** Off (the default in 4.3 and later) is recommended unless
  your project needs threads: it needs no special server headers, so it works on hosts
  and embeds that cannot set them, such as itch.io's HTML5 embed by default. Turn it on
  for projects that need threads (background loading, threaded physics or audio, or
  other add-ons that require them); the export then needs cross-origin isolation (below).
- **No special server headers without threads.** A non-threaded export does not need the
  cross-origin isolation headers. CI serves it without them and checks that the page is
  not cross-origin isolated and that it loads `mumble_godot.wasm` only.
- **Threads need cross-origin isolation.** A threaded export needs `SharedArrayBuffer`,
  which browsers offer only to a cross-origin isolated page: serve every file of the
  export with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. To check, type `crossOriginIsolated` in
  the browser console: it must print `true`. CI serves the threaded export with these
  headers and checks that the page is cross-origin isolated and loads
  `mumble_godot.threads.wasm` only. The ways to get the headers:
  - your own server or CDN: add the two headers;
  - Godot's *Progressive Web App* export option with *Ensure Cross Origin Isolation
    Headers* on: a service worker adds the headers after a reload, so it works on a static
    host that cannot set them (the first visit reloads once);
  - itch.io: turn on *SharedArrayBuffer support* in the project's embed options;
  - the editor's **Remote Debug → Run in Browser** already serves the headers;
  - some hosts and embeds allow none of these: use Thread Support off there.
- **A threaded export served without the headers** does not start. Symptom: TBD (to be
  recorded from the manual check GW7 in `bindings/godot/TESTING.md`; usually Godot
  reports that cross-origin isolation or `SharedArrayBuffer` is missing).
- **Main thread only.** The addon's classes (`Mumble`, `MumbleVoice`, `MumbleSpeaker`,
  `MumbleTypewriter`) are used from the main thread, as on desktop; do not call them from
  a `Thread`. On the web a failed check there aborts the whole game.
- **A user gesture before audio is heard.** Browsers keep audio suspended until the
  player clicks, taps or presses a key on the page. A line said earlier is silent, but
  see the timing below: its signals still arrive.
- **Playback mode.** The default for web exports is *Sample* playback
  (Project Settings → Audio → General → Default Playback Type), which the addon supports.
  In this mode the browser plays the sound, not the engine's mixer, so on the web
  `character_spoken` and `finished` are emitted according to the time elapsed since
  `say` was called, not to the audio clock: each `character_spoken` arrives no earlier
  than the character's start and at most 100 ms plus one frame after it, and `finished`
  at most 250 ms plus one frame after the line's duration, also before the browser has
  allowed audio (the line is then silent and the signals still arrive, so a game that
  waits for `finished` never hangs). The sound can lag the signal by the browser's
  output latency, typically 10 to 40 ms. In *Stream* playback mode the audio clock is
  used, as on desktop, but on the web it advances in large chunks behind a large output
  latency: each `character_spoken` can arrive up to 500 ms plus one frame after its
  start (the same bound as `finished`), not 100 ms.
- **Empty lines.** A line that renders no samples (empty text, or text with nothing to say)
  is not played, because Web Audio rejects a zero-length buffer; `finished` is still
  emitted once. `render_stream` can return an empty stream (0 frames): do not play it on
  the web.
- **`speak_character` and the typewriter** need no change: the typewriter waits with the
  frame time, not the audio clock.

Sizes of this addon on the web:

An export includes only one of the two libraries.

| | Without threads | With threads |
|---|---|---|
| Library | `mumble_godot.wasm` | `mumble_godot.threads.wasm` |
| Raw | 520,810 bytes (about 509 KiB) | TBD (measured by CI) |
| gzip (`gzip -9`) | 175,773 bytes (about 172 KiB) | TBD (measured by CI) |
| Increase of the `dlink` export template over the standard one | TBD (not measured yet) | TBD (not measured yet) |

To build both web libraries from source you need the pinned nightly Rust and
Emscripten (`scripts/godot-web/versions.env`, currently Emscripten 3.1.74):

```sh
bindings/godot/build.sh web    # writes both libraries into addons/mumble_speech/bin/ and checks them
```

CI exports the test runner of `bindings/godot` with Godot 4.3 and 4.7.2, without threads
(served without the headers) and with threads (served with them), and runs both in
Chromium, with audio running and with audio blocked: every conformance vector must be
bit-identical in the browser and the timing above must hold in both. Firefox and desktop
Safari are checked by hand (`bindings/godot/TESTING.md`); please
[report what you find](https://github.com/basteez/mumble-speech/issues/new?template=godot_web_verification.yml).

## Example project

`bindings/godot` is itself a Godot project: open it and press Play for a three-line
dialogue. Its headless tests run every conformance vector:

```sh
godot --headless --path bindings/godot -s res://tests/run_tests.gd
```
