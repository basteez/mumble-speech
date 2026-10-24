# Mumble Speech for Unity

Video-game "mumble speech" generated at runtime: `Beep` (Undertale), `Grunt`
(Banjo-Kazooie) and `Alphabet` (Animal Crossing). Same output, bit for bit, as
the web, C and Godot bindings. Unity 2022.3 LTS or later, desktop (Windows,
macOS, Linux).

> Early development: no prebuilt release yet. Build the native library first:
> `bindings/unity/build.sh` (needs Rust).

## Install

Package Manager → **Add package from disk…** → select `bindings/unity/package.json`.

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

## Tests

Window → General → Test Runner → EditMode → run `MumbleSpeech.Tests.EditMode`
(all conformance vectors through the native library).
