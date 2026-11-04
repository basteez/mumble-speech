# Mumble Speech for Unity

Video-game "mumble speech" generated at runtime: `Beep` (Undertale), `Grunt`
(Banjo-Kazooie) and `Alphabet` (Animal Crossing). Same output, bit for bit, as
the web, C and Godot bindings. Unity 2022.3 LTS or later, desktop (Windows,
macOS, Linux).

## Install

Install the package that carries the native libraries, with any of these:

- Package Manager → **Add package from git URL…**
  `https://github.com/basteez/mumble-speech.git#upm` (append `/vX.Y.Z` to pin a version);
- [OpenUPM](https://openupm.com/packages/com.mumble-speech.unity/):
  `openupm add com.mumble-speech.unity`;
- the `com.mumble-speech.unity-<version>.tgz` of a
  [GitHub release](https://github.com/basteez/mumble-speech/releases): Package Manager →
  **Add package from tarball…**.

### From source

`bindings/unity` in a source checkout (git clone or *Download ZIP*) contains **no native
libraries**: its `Plugins/` folders are empty, and the first call fails with a
`DllNotFoundException` that names the missing file. It is meant for contributors, who
build the library first:

macOS, Linux, and Windows with Git Bash or MSYS2 (needs Rust):

```sh
bindings/unity/build.sh
```

Windows without a POSIX shell (PowerShell, from the repository root):

```powershell
cargo build -p mumble-ffi --release
Copy-Item target\release\mumble_ffi.dll bindings\unity\Plugins\Windows\x86_64\
```

Then Package Manager → **Add package from disk…** → `bindings/unity/package.json`.
Build **before** adding the folder to a project: otherwise Unity may drop the plugins'
`.meta` files, and with them the platform settings.

## Use

```csharp
using MumbleSpeech;

// A GameObject with an AudioSource and a MumbleSpeaker.
speaker.voice = myVoice;                    // Assets → Create → Mumble Speech → Voice
speaker.onCharacter.AddListener(i => ...);  // UTF-16 index of the character being heard
speaker.onFinished.AddListener(() => ...);
speaker.Say("Hello there!");

// Typewriter dialogue with TextMeshPro (compiled only when TMP is installed):
typewriter.label = tmpText;
typewriter.speaker = speaker;
typewriter.TypeText("Guh-huh! Did you bring the honey?");   // Skip(), IsTyping, onFinished

// Lower level, no UnityEngine: MumbleSpeech.Mumble.Render(...), MumbleSpeech.Speaker
```

| Type | Purpose |
|---|---|
| `MumbleVoice` (ScriptableObject) | style, pitch (−12..12), speed (5..30 chars/s), variation (0..1), seed |
| `MumbleSpeaker` (MonoBehaviour) | `Say`, `SpeakCharacter` → seconds to wait, `ResetSpeaker`, `Stop`, `IsSpeaking`, `onCharacter`, `onFinished` |
| `MumbleTypewriterTMP` (MonoBehaviour) | `TypeText`, `Skip`, `IsTyping`, `onFinished` |
| `Mumble`, `Speaker` (plain C#) | raw samples and events, typewriter speaker, WAV encoding |

Nothing is drawn by the package: the TMP typewriter only sets `maxVisibleCharacters`.
Events from `Mumble.Render` carry `Style` and `Variant` (which grunt 0–3, which letter
0–25, 26 neutral): use them for mouth shapes or effects.

## Tests

See [TESTING.md](TESTING.md): a step-by-step checklist (U1–U3 and U5) for trying the package
in the Unity editor, including the EditMode tests that run all conformance vectors
through the native library.
