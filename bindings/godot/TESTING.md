# Testing the Godot web export (checklist GW1–GW5)

A guide for whoever tries the Godot addon in a browser. It takes about 30 minutes.
Please report the results with the issue form
[Godot web verification report](https://github.com/basteez/mumble-speech/issues/new?template=godot_web_verification.yml),
even if everything works.

CI already exports the test runner with Godot 4.3 and 4.7.2 and runs it in Chromium, with
audio running and with audio blocked (every conformance vector, the timing of
`character_spoken` and `finished`). What needs a human is everything CI cannot do: Safari,
Firefox with a real audio device, hearing that the sound is in sync, and the browser's memory
tool.

## Before you start

- **Godot 4.3** and the **latest 4.x**, with the official export templates installed
  (**Editor → Manage Export Templates**).
- The latest Chrome, Firefox and desktop Safari.
- The web library: either the released addon (`mumble-speech-godot-X.Y.Z.zip`, unzipped into
  a project) or, from a source checkout, `bindings/godot/build.sh web` (needs the pinned
  nightly Rust and Emscripten, see `scripts/godot-web/versions.env`).

## GW1 — Export the example and run it

1. Open `bindings/godot` (or your project with the addon) in Godot and open
   **Project → Export…**. Use the `Web` preset, or add a Web preset with
   **Extensions Support** on and **Thread Support** off.
2. **Export Project…** to `build/web/index.html` (untick *Export With Debug* if you like).
3. Serve the folder with a plain static server, no extra headers:
   `python3 -m http.server -d build/web 8000`.
4. Open `http://localhost:8000/` in each browser, click the page once, then press Space or
   Enter.
5. Expected: the example types its line letter by letter with sound in sync, as on desktop;
   no error in the browser console; `crossOriginIsolated` typed in the console prints `false`.

## GW2 — Timing and memory with sound

1. Export the `Web (tests)` preset as in GW3 (it needs `conformance/vectors.json` copied to
   `bindings/godot/tests/web/vectors.json`: `scripts/godot-web/export.sh` does it).
2. Open it with the speakers on and the browser's memory tool open (Chrome: *Memory* or the
   task manager; Firefox: *about:memory*; Safari: *Develop → Timelines*). The runner says a
   line and types a 500-character one.
3. Expected: each character sounds as its letter appears; the `say` line ends as `finished` is
   logged, within about a frame plus the browser's output latency; memory returns to its level
   after the long line (no growth with the length of the line).

## GW3 — The test runner in Firefox and Safari

1. Export the `Web (tests)` preset (`scripts/godot-web/export.sh <godot binary> build/web-tests`
   does the same without the editor), serve the folder as in GW1.
2. Open it in Firefox and in Safari, click once.
3. Expected: the page console ends with `MUMBLE_WEB_TESTS PASS`: every conformance vector is
   bit-identical in the browser and the timing checks pass.

## GW4 — Thread Support on

1. Export the `Web` preset with **Thread Support** on. Serve it with and without the
   `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
   headers.
2. Record what happens: an export error, a load error in the browser console, or a silent
   failure. The documentation (`docs/bindings/godot.md`, *Web export*) must describe it.

## GW5 — iOS Safari and itch.io (optional)

1. Open the GW1 export on an iPhone or iPad in Safari; tap the page.
2. Zip the export, upload it to itch.io as an HTML game (embedded in the page, *SharedArrayBuffer
   support* off) and open it.
3. Expected: the line speaks after a tap, as in GW1.
