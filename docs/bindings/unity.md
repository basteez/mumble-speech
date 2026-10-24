# Unity

A UPM package for **Unity 2022.3 LTS and later** (Unity 6 included) on Windows, macOS
and Linux. Audio is generated at runtime; nothing is drawn by the package.

::: warning Manual verification in progress
The C# interop layer is tested in CI with .NET against the native library. The parts
that need the Unity editor (components, sample, TextMeshPro typewriter) are being
checked by hand with [this guide](https://github.com/basteez/mumble-speech/blob/main/bindings/unity/TESTING.md).
:::

## Install

Build the native library into the package (needs Rust), then in Unity use
**Package Manager → + → Add package from disk…** and pick `bindings/unity/package.json`:

```sh
bindings/unity/build.sh
```

## Use

```csharp
using MumbleSpeech;

// A GameObject with an AudioSource and a MumbleSpeaker.
speaker.voice = myVoice;                    // Assets → Create → Mumble Speech → Voice
speaker.onCharacter.AddListener(i => Debug.Log(i));   // UTF-16 index being heard
speaker.onFinished.AddListener(() => Debug.Log("done"));
speaker.Say("Hello there!");

// Typewriter dialogue with TextMeshPro (compiled only when TMP is installed).
typewriter.label = tmpText;
typewriter.speaker = speaker;
typewriter.TypeText("Guh-huh! Did you bring the honey?");
```

## Types

| Type | Members |
|---|---|
| `MumbleVoice` (ScriptableObject) | `style`, `pitch`, `speed`, `variation`, `seed` |
| `MumbleSpeaker` (MonoBehaviour) | `voice`; `Say`, `SpeakCharacter` → seconds to wait, `ResetSpeaker`, `Stop`, `IsSpeaking`; `onCharacter`, `onFinished` |
| `MumbleTypewriterTMP` (MonoBehaviour) | `label`, `speaker`; `TypeText`, `Skip`, `IsTyping`; `onFinished` |
| `Mumble` (static, plain C#) | `Render(text, settings, sampleRate)`, `EncodeWav`, `NativeAbiVersion` |
| `Speaker` (plain C#, `IDisposable`) | `Next(text)` → samples, advance, sound; `Reset` |

`Mumble` and `Speaker` live in the `MumbleSpeech.Core` assembly, which has no
`UnityEngine` reference: you can use them from any C# code. Events carry `CharIndex`
and `CharLength` (UTF-16, so they index C# strings), `Style` and `Variant`.
