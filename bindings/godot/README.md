# mumble-speech for Godot 4

Video-game "mumble speech" generated at runtime: `beep` (Undertale), `grunt`
(Banjo-Kazooie) and `alphabet` (Animal Crossing). Same output, bit for bit, as
the web, C and Unity bindings for the same text, voice and sample rate. Godot 4.3 or later, desktop (Windows, macOS, Linux) and web.

## Install

Download `mumble-speech-godot-X.Y.Z.zip` from the
[latest release](https://github.com/basteez/mumble-speech/releases/latest) (or install
*Mumble Speech* from the Asset Library) and unzip it into your project, so that
`addons/mumble_speech/` sits at its root. From a source checkout instead (needs Rust):

```sh
bindings/godot/build.sh        # builds the GDExtension into addons/mumble_speech/bin
bindings/godot/build.sh web    # both web libraries, with and without threads (pinned nightly Rust and Emscripten, see below)
```

Copy `addons/mumble_speech/` into your project.

## Web export

Godot 4.3 or later. In **Project → Export… → Web** turn **Extensions Support** on (it
selects the `dlink` export templates, included in the official template package). The
addon ships a library without threads (`mumble_godot.wasm`) and one with threads
(`mumble_godot.threads.wasm`); Godot picks the one that matches **Thread Support**, and an
export includes only that one.

- **Thread Support off** (recommended unless your project needs threads): no special server
  headers, so it also works on itch.io's embed and on hosts that cannot set headers.
- **Thread Support on**: the page must be served with `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (check that
  `crossOriginIsolated` prints `true` in the browser console), through your server, Godot's
  *Progressive Web App* option (*Ensure Cross Origin Isolation Headers*), itch.io's
  *SharedArrayBuffer support* option, or the editor's *Remote Debug → Run in Browser*, which
  already sends them. Without the headers the export does not start. Use the addon's classes
  from the main thread only.

Browsers keep audio suspended until the first click, tap or key press on the page. In the default
*Sample* playback mode, `character_spoken` and `finished` follow the time since `say`, so
they arrive even before audio is allowed (the line is then silent); see
[the documentation](https://mumble-speech.github.io/bindings/godot#web-export) for the
timing, the size of both libraries and of the two `dlink` templates, and what to expect
from each browser.

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

`MumbleSpeaker` always synthesizes at 48 kHz (`MumbleSpeaker.SAMPLE_RATE`), whatever the
output rate, and Godot resamples on playback, so a line gives the same samples on every
device. Use `Mumble.render` with an explicit rate for anything else.

Nothing is drawn by the addon: the typewriter only sets `visible_characters` on
the label you point it to. `Mumble.render` events also carry `style` and `variant`
(which grunt 0–3, which letter 0–25, 26 neutral): use them for mouth shapes or effects.

## This folder

It is also a Godot project: `example/dialogue.tscn` (open the folder in Godot and
press Play) and `tests/run_tests.gd`:

```sh
godot --headless --path bindings/godot -s res://tests/run_tests.gd
```

The checks are in `tests/suite.gd`, shared with the web runner `tests/web/runner.tscn`
(exported with the `Web (tests)` preset and run in a browser by `scripts/godot-web/`).
`export_presets.cfg` has the `Web` preset (the example scene) and `Web (tests)`. To try the
example in a browser: `bindings/godot/build.sh web`, export the `Web` preset, serve
`build/web/` with any static server (`python3 -m http.server`), click the page and press
Space. The manual checks for browsers are in [TESTING.md](TESTING.md).
