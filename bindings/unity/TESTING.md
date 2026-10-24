# Testing the Unity package (checklist U1–U3)

A guide for whoever tries the package in Unity. It takes about 20 minutes. Please
report the results with the template at the end, even if everything works.

The C# interop layer is already tested in CI with plain .NET; what needs a human is
everything that touches the Unity editor: package import, native plugin settings,
components, the sample and the TextMeshPro typewriter.

## Before you start

- Unity **2022.3 LTS** or **Unity 6**, on Windows, macOS or Linux.
- Nothing else: the package installs from git with its native libraries.

## U1 — Install the package and run the sample

1. Create a new 3D project in Unity Hub.
2. **Window → Package Manager → + → Add package from git URL…** and paste
   `https://github.com/basteez/mumble-speech.git#upm`.
3. Expected: "Mumble Speech 0.1.0" in the list, **no errors in the Console**.
4. Select `Packages/Mumble Speech/Plugins/<your OS>/` and click the library file:
   in the Inspector, **Editor** and your standalone platform must be ticked, the others
   not.
5. In the package page, **Samples → Basic → Import**.
6. In the scene: **GameObject → Create Empty**, then **Add Component**:
   `AudioSource`, `MumbleSpeaker`, `BasicDialogue`.
7. Press **Play**.
8. Expected: you hear three lines in three styles (Animal Crossing-like voice, then
   grunts, then beeps), and each line appears on screen as it is spoken, in sync.

## U2 — Run the EditMode tests

1. Open `Packages/manifest.json` of the project and add, at the top level:
   ```json
   "testables": ["com.mumble-speech.unity"]
   ```
2. **Window → General → Test Runner → EditMode → Run All**.
3. Expected: `MumbleSpeech.Tests.EditMode` → `ConformanceVectorsAndErrorCases`
   passes. If it fails, copy its message.

## U3 — TextMeshPro typewriter

1. Make sure TextMeshPro is installed: in Unity 2022.3 add `com.unity.textmeshpro` from
   the Package Manager and import **TMP Essential Resources** when asked; in Unity 6 it
   is already part of uGUI.
2. **GameObject → UI → Text - TextMeshPro**.
3. On the GameObject from U1, remove `BasicDialogue`, add `MumbleTypewriterTMP`, drag
   the text into **Label** and the GameObject itself into **Speaker**.
4. Add this script to the same GameObject:
   ```csharp
   using MumbleSpeech;
   using UnityEngine;

   public class TypewriterTest : MonoBehaviour
   {
       void Start() => GetComponent<MumbleTypewriterTMP>().TypeText("Guh-huh! Did you bring the honey?");

       void Update()
       {
           if (Input.GetMouseButtonDown(0)) GetComponent<MumbleTypewriterTMP>().Skip();
       }
   }
   ```
   (With the new Input System only, replace the `Update` body with nothing: Skip is optional.)
5. Press **Play**.
6. Expected: the text is revealed letter by letter in sync with the voice; a click
   shows it all at once and stops the voice.
7. Optional: **Assets → Create → Mumble Speech → Voice**, change style and pitch, assign
   it to the `MumbleSpeaker`'s **Voice** field, Play again: the voice changes.

## Report template

```
Unity version:
OS and CPU (e.g. macOS 15 arm64, Windows 11 x64):
U1 install + sample:      pass / fail — notes:
U1 plugin settings:       pass / fail — notes:
U2 EditMode tests:        pass / fail — notes:
U3 TMP typewriter:        pass / fail — notes:
Console errors or warnings (copy them):
```
