# Testing the Unity package (checklist U1–U3 and U6–U8)

A guide for whoever tries the package in Unity. It takes about 20 minutes. Please
report the results with the template at the end, even if everything works.

The C# interop layer is already tested in CI with plain .NET; what needs a human is
everything that touches the Unity editor: package import, native plugin settings,
components, the sample and the TextMeshPro typewriter.

## Before you start

- Unity **2022.3 LTS** or **Unity 6**, on Windows, macOS or Linux (and, for U6–U8, an
  Android device).
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

## Android (U6–U8)

For whoever has an Android device. Needs Unity with **Android Build Support** (and its
OpenJDK and SDK/NDK modules), and a device with USB debugging.

### U6 — Build the sample for Android and run it

1. In the project from U1, **File → Build Profiles** (Unity 6) or **Build Settings**
   (2022.3): switch to **Android**.
2. **Player Settings → Other Settings**: Scripting Backend **IL2CPP**, Target
   Architectures **ARM64** and **ARMv7** ticked.
3. In the Project window select each
   `Packages/Mumble Speech/Plugins/Android/libs/<abi>/libmumble_ffi.so`. Inspector:
   only **Android** is ticked, with the CPU of the folder (ARM64, ARMv7, X86_64). The
   desktop libraries have Android unticked.
4. Add the `Basic` sample scene to the build, **Build And Run** on an ARM64 device.
5. Expected: the sample speaks and types the lines; `adb logcat -s Unity` shows no
   `DllNotFoundException` or `EntryPointNotFoundException`. Unzip the APK: it has
   `lib/arm64-v8a/` and `lib/armeabi-v7a/` with `libmumble_ffi.so` and no desktop
   library.

### U7 — Run the conformance vectors on the device

1. With `testables` set as in U2 and the device connected: **Window → General → Test
   Runner → PlayMode → Run All in Player** (target: Android).
2. Expected: `MumbleSpeech.Tests.Runtime` → `PlayerVectorTests` →
   `ConformanceVectorsAndErrorCases` passes: every vector is bit-identical on the device.

### U8 — Other architectures and 16 KB alignment (optional)

1. Run the U6 build on a 32-bit ARM device (or with only ARMv7 ticked) and on an x86_64
   emulator or ChromeOS device.
2. Open the APK in Android Studio (**Build → Analyze APK**).
3. Expected: the sample speaks on each; APK Analyzer shows no 16 KB alignment warning
   for `libmumble_ffi.so`.

## Report template

The easiest way: open a
[Unity verification report](https://github.com/basteez/mumble-speech/issues/new?template=unity_verification.yml)
issue, which asks for exactly these fields. Or copy this:

```
Unity version:
OS and CPU (e.g. macOS 15 arm64, Windows 11 x64):
U1 install + sample:      pass / fail — notes:
U1 plugin settings:       pass / fail — notes:
U2 EditMode tests:        pass / fail — notes:
U3 TMP typewriter:        pass / fail — notes:
U6 Android sample:        pass / fail / not tested — device, notes:
U7 Android vectors:       pass / fail / not tested — notes:
U8 other ABIs, 16 KB:     pass / fail / not tested — notes:
Console errors or warnings (copy them):
```
