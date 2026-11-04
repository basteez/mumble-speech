# Godot

A GDExtension addon for **Godot 4.3 and later** on Windows, macOS and Linux. Audio is
generated at runtime; nothing is drawn by the addon.

## Install

From the [Godot Asset Library](https://godotengine.org/asset-library/asset/5553): in
the editor, open the **AssetLib** tab, search for *Mumble Speech* and install it.

Or download `mumble-speech-godot-X.Y.Z.zip` from the
[latest release](https://github.com/basteez/mumble-speech/releases/latest) and unzip it
into your project, so that `addons/mumble_speech/` sits at its root. The same addon is
on the [`godot-addon`](https://github.com/basteez/mumble-speech/tree/godot-addon)
branch, which is what the Asset Library entry points to.

To build from source (needs Rust): `bindings/godot/build.sh`.

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
the last mix, output latency), so they match what the player hears.

## Example project

`bindings/godot` is itself a Godot project: open it and press Play for a three-line
dialogue. Its headless tests run every conformance vector:

```sh
godot --headless --path bindings/godot -s res://tests/run_tests.gd
```
