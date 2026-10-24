# Godot

A GDExtension addon for **Godot 4.3 and later** on Windows, macOS and Linux. Audio is
generated at runtime; nothing is drawn by the addon.

## Install

Download `mumble-speech-godot-X.Y.Z.zip` from the
[latest release](https://github.com/basteez/mumble-speech/releases/latest) and unzip it
into your project, so that `addons/mumble_speech/` sits at its root. The same addon is
on the [`godot-addon`](https://github.com/basteez/mumble-speech/tree/godot-addon)
branch, which is what the Godot Asset Library entry points to.

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

`character_spoken` and `finished` follow the audio clock (playback position, time since
the last mix, output latency), so they match what the player hears.

## Example project

`bindings/godot` is itself a Godot project: open it and press Play for a three-line
dialogue. Its headless tests run every conformance vector:

```sh
godot --headless --path bindings/godot -s res://tests/run_tests.gd
```
