# mumble-speech for Godot 4

Video-game "mumble speech" generated at runtime: `beep` (Undertale), `grunt`
(Banjo-Kazooie) and `alphabet` (Animal Crossing). Same output, bit for bit, as
the web, C and Unity bindings. Godot 4.3 or later, desktop (Windows, macOS, Linux).

> Early development: no prebuilt release yet, build the addon from source.

## Install

```sh
bindings/godot/build.sh        # builds the GDExtension into addons/mumble_speech/bin
```

Copy `addons/mumble_speech/` into your project.

## Use

```gdscript
var voice := MumbleVoice.new()        # or create one in the inspector
voice.style = MumbleVoice.ALPHABET
voice.pitch = 2.0

$MumbleSpeaker.voice = voice
$MumbleSpeaker.say("Hello there!")    # signals: character_spoken(char_index), finished

# Typewriter dialogue: reveals a Label / RichTextLabel in sync with the voice.
$MumbleTypewriter.label = $Label.get_path()
$MumbleTypewriter.speaker = $MumbleSpeaker.get_path()
$MumbleTypewriter.type_text("Guh-huh! Did you bring the honey?")   # skip(), is_typing(), finished
```

| Class | Purpose |
|---|---|
| `MumbleVoice` (Resource) | `style`, `pitch` (−12..12), `speed` (5..30 chars/s), `variation` (0..1), `seed` |
| `MumbleSpeaker` (Node) | `say(text)`, `speak_character(text) → seconds to wait`, `reset()`, `stop()`, `render_stream(text) → AudioStreamWAV`, `bus`, `volume_db` |
| `MumbleTypewriter` (Node) | `type_text(text)`, `skip()`, `is_typing()`, signal `finished` |
| `Mumble` (static) | `render(text, voice, sample_rate) → { samples, duration, events }`, `encode_wav(samples, sample_rate)` |

Nothing is drawn by the addon: the typewriter only sets `visible_characters` on
the label you point it to. `Mumble.render` events also carry `style` and `variant`
(which grunt 0–3, which letter 0–25, 26 neutral): use them for mouth shapes or effects.

## This folder

It is also a Godot project: `example/dialogue.tscn` (open the folder in Godot and
press Play) and `tests/run_tests.gd`:

```sh
godot --headless --path bindings/godot -s res://tests/run_tests.gd
```
