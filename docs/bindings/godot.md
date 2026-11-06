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

The addon includes a WebAssembly library (`addons/mumble_speech/bin/mumble_godot.wasm`),
so `Mumble`, `MumbleVoice`, `MumbleSpeaker` and `MumbleTypewriter` work in a web export
with the same API and the same samples as on desktop. Export settings
(**Project → Export… → Add… → Web**):

- **Godot 4.3 or later.** Earlier versions only export the web with threads, which the
  addon does not support.
- **Extensions Support: on.** The web export then uses the `dlink` export templates,
  which are part of the official export template package (nothing extra to download).
- **Thread Support: off** (the default in 4.3 and later). The addon ships a build
  without threads only. A threaded export still picks that library (Godot matches the
  `web.*.wasm32` entries whatever the threads setting), but threaded exports are not
  supported and the result is not verified yet (it is likely not to load). Turn Thread Support off.
- **No special server headers.** Without threads, the export does not need the
  cross-origin isolation headers (`Cross-Origin-Opener-Policy`,
  `Cross-Origin-Embedder-Policy`), so it also works on hosts that cannot set them, such
  as itch.io's HTML5 embed. CI serves the export without them and checks that the page
  is not cross-origin isolated.
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
  used, as on desktop.
- **Empty lines.** A line that renders no samples (empty text, or text with nothing to say)
  is not played, because Web Audio rejects a zero-length buffer; `finished` is still
  emitted once. `render_stream` can return an empty stream (0 frames): do not play it on
  the web.
- **`speak_character` and the typewriter** need no change: the typewriter waits with the
  frame time, not the audio clock.

Sizes of this addon on the web:

| | Size |
|---|---|
| `mumble_godot.wasm`, raw | 520,810 bytes (about 509 KiB) |
| `mumble_godot.wasm`, gzip | 175,773 bytes (about 172 KiB, `gzip -9`) |
| Increase of the `dlink` export template over the standard one | TBD (not measured yet) |

To build the web library from source you need the pinned nightly Rust and
Emscripten (`scripts/godot-web/versions.env`, currently Emscripten 3.1.74):

```sh
bindings/godot/build.sh web    # writes addons/mumble_speech/bin/mumble_godot.wasm and checks it
```

CI exports the test runner of `bindings/godot` with Godot 4.3 and 4.7.2 and runs it in
Chromium, with audio running and with audio blocked: every conformance vector must be
bit-identical in the browser and the timing above must hold. Firefox and desktop Safari
are checked by hand (`bindings/godot/TESTING.md`); please
[report what you find](https://github.com/basteez/mumble-speech/issues/new?template=godot_web_verification.yml).

## Example project

`bindings/godot` is itself a Godot project: open it and press Play for a three-line
dialogue. Its headless tests run every conformance vector:

```sh
godot --headless --path bindings/godot -s res://tests/run_tests.gd
```
