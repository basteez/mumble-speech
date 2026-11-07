# Implementation plan

Status: **approved on 2026-10-19.** Each phase closes with green CI; each
task cites the requirements it covers.

## Phase A — Foundations

- [x] **A1** `git init`, monorepo structure (design §1), Cargo and npm workspaces.
- [x] **A1b** Bring the playground back into `apps/playground` with its git history; its specs move to `specs/playground/`. — L6.1, LD9
  - Done when: the playground passes tests and build from `apps/playground` and is marked private.
- [x] **A2** Public GitHub repository `basteez/mumble-speech` and minimal CI (core and playground jobs). — LQ3, L6.1
  - Done when: CI is green on the first push.

## Phase B — Rust core

- [x] **B1** `mumble-core`: types, normalization, tokenization by grapheme, RNG. — L1.2 (R1.4, R1.5), L1.3
- [x] **B2** Styles `beep`, `grunt`, `alphabet` and scheduling, with seed from voice. — L1.2 (R3.x, R4.2, R4.3), L1.6, LD1
- [x] **B3** Synthesis with `libm`, per-sound peak limiting, WAV. — L1.2 (R5.5, R7.1, R7.4), L1.4, L1.5, LD2
- [x] **B4** `Speaker` and `render` built on top of the Speaker. — L2.1–L2.3, L3.1–L3.4
  - Done when: a property test on 200 random texts confirms L3.2 bit for bit.
- [x] **B5** Port of all the core's Vitest tests to Rust, plus the L2.5 benchmark.
  - Done when: every TS test has a Rust counterpart (table at the bottom of the test file).

## Phase C — Conformance

- [x] **C1** `mumble-conformance`: list of cases, generation of `conformance/vectors.json` and of the vectors' C header. — L5.1, LD7
- [x] **C2** Core CI on Linux, macOS and Windows with vector verification. — L1.4

## Phase D — Web

- [x] **D1** `mumble-wasm` + `@mumble-speech/web` (API from design §9.1, `WebAudioPlayer`). — L4.1
- [x] **D2** Vitest tests of the package: vectors in Node, size budget. — L1.4, L4.2, L5.2
- [x] **D3** External consumption check in CI: `npm pack`, installation of the tarball in an empty project, use of the public API. — L6.2
  - After D3, the playground migrates to the package: tasks P1–P3 in `playground/tasks.md`.

## Phase E — C ABI

- [x] **E1** `mumble-ffi` with `catch_unwind`, error codes, `cbindgen` header. — L4.3–L4.5
- [x] **E2** C example and CTest tests on the vectors; CI build for the three platforms (macOS universal). — L4.3, L5.2

## Phase F — Godot

- [x] **F1** `mumble-godot` with `gdext`: `MumbleVoice`, `MumbleSpeaker`, `MumbleTypewriter`. — L4.6
- [x] **F2** Addon in `bindings/godot`, example project and headless tests in CI. — L4.6, L4.9, L5.2
- [x] **F3** Manual verification in Godot 4.3 desktop: example, inspector, typewriter (checklist G1–G3). — L4.6
  - Outcome: verified by the user on Godot 4.7.2, macOS (2026-10-24); Godot 4.3 covered by the CI headless tests.

## Phase G — Unity

- [x] **G1** UPM package: `Runtime/Core` interop, `MumbleVoice`, `MumbleSpeaker`, optional TMP typewriter, plugin `.meta` files. — L4.7, LD13
- [x] **G2** `Basic` sample, EditMode tests on the vectors (generated `Vectors.cs`), CI `unity-interop` job with .NET. — L4.9, L5.2, LD13
- [ ] **G3** Manual verification in Unity 2022.3 LTS (checklist U1–U3). — L4.7
- [ ] **G4** Source checkouts without native plugins (issue #24): `Native.EnsureLoaded` and `Native.LoadFailureMessage` in `Runtime/Core`, called by the four entry points; `build.sh` fallback branch; install and build-from-source text in `bindings/unity/README.md` (drop the stale "no prebuilt release yet" note), `docs/bindings/unity.md` (*From source* section) and the root README; CI `unity-interop` second run. — L4.11, L4.12, LD19, LD20
  - Done when:
    - library present (happy path): the existing `unity-interop` run passes every vector and error case unchanged, and calling an entry point twice checks the library once;
    - library missing: the second run (`--expect-load-failure`, no `LD_LIBRARY_PATH`) asserts that `Mumble.Render`, `Mumble.EncodeWav`, `Mumble.NativeAbiVersion` and `new Speaker` each throw `DllNotFoundException`, with a non-null `InnerException` of the same type and the Linux message (`libmumble_ffi.so`, `Plugins/Linux/x86_64/`, `#upm`, `openupm add com.mumble-speech.unity`, the `#from-source` URL); a second call throws again (failure not cached);
    - message per platform: `LoadFailureMessage` checked for Windows x64 (`mumble_ffi.dll`, `Plugins/Windows/x86_64/`), macOS arm64 and x64 (`libmumble_ffi.dylib`, `Plugins/macOS/`), Linux x64; edge cases: Windows and Linux arm64 mention x86_64-only libraries, an unknown OS lists the three folders and the supported platforms; no message contains a package version;
    - `build.sh` on an unsupported `uname -s` (simulated with a stub `uname` on `PATH`) prints the manual steps to standard error and exits 1; on Linux it still copies the library;
    - the site builds (the new anchor `#from-source` exists, no dead links), and review confirms the READMEs and the docs page match design §9.4 (L4.12);
    - a release dry run still passes `verify.sh` (no new file in the package without its `.meta`);
    - manual U5 is added to `TESTING.md` and run when a Unity editor is available (it does not block closing the task).

## Phase H — Sound identifier, READMEs, site, release

- [x] **I1** Core: `SoundId` (style + variant) in events and utterances instead of the dot; conformance vectors format 2. — L2.3, L3.1, LD14
- [x] **I2** Bindings follow LD14: web (`sound`), C ABI version 2, Godot (`style`, `variant`), Unity (`Style`, `Variant`, `HasSound`); the playground maps variants to colors (`src/ui/dots.ts`). — L4.x, R6.2
  - Done when: every suite passes the format-2 vectors and the playground looks as before (headless smoke test).
- [x] **H2** README for each binding with a short example, and a test guide for the Unity checklist U1–U3 (for whoever runs G3). — L4.8, L4.9
- [x] **J1** VitePress site in `docs/`: home, guide, one page per binding, reference, contributing. — L7.1
- [x] **J2** `npm run build:site` (docs at `/`, playground at `/playground/`); CI `site` job on every PR, required. — L7.2, L7.3
- [x] **J3** Organization `mumble-speech` (created by the user), repository `mumble-speech.github.io`, deploy key and secret, Pages enabled, deploy on push to `main`. — L7.4, LD15
  - Done when: `https://mumble-speech.github.io/` and `/playground/` serve the latest `main`.
  - Outcome: deployed by the `main` run after #11; all pages and the playground checked live in headless Chrome (2026-10-24).
- [x] **H1** `release.yml`: version check, native builds, web package, four archives, GitHub Release; manual dry run. — L8.1, L8.2
  - Done when: a dry run on `main` produces the four archives, and they are checked (Godot addon loads, C archive links, Unity tarball has plugins and metas, npm tarball installs).
  - Outcome: dry run on #12 (pull request trigger): four archives built and verified, `publish` skipped (2026-10-24).
- [x] **H4** Release notes and changelog: `CHANGELOG.md` with the 0.1.0 section, `scripts/release/notes.mjs`, `notes` job, `SHA256SUMS.txt`, changelog page on the site. — L8.3, L8.4
  - Done when: a dry run shows the complete notes in the run summary and the user has seen the preview.
  - Outcome: preview from the dry run on #14 approved by the user (2026-10-24).
- [x] **K1** Registry jobs in `release.yml` (`npm`, `crates`, `upm`, `godot-addon`), crate metadata and README, `cargo publish --dry-run` on PRs, icon. — L9, LD16
  - Outcome: crate dry run in CI; `publish-branch.sh` tested against a local repository (new branch, later releases, fresh clone). The registry jobs themselves first run on the `v0.1.0` tag.
- [x] **K2** One-time account setup by the maintainer (npm organization and first token, crates.io account and first token), guided step by step. — L9.1, L9.2
- [x] **H3** First release `v0.1.0`, only with the user's go-ahead. — L8.1, L9
  - Outcome: `v0.1.0` released on 2026-10-24: GitHub Release, npm, crates.io (after re-running the job once the maintainer's crates.io email was verified), `upm` and `godot-addon` branches.
- [x] **K4** Prerelease support (L8.5) and a test prerelease `v0.1.1-rc.1` to check trusted publishing on npm and crates.io, only with the user's go-ahead. — L8.5, L9.1, L9.2
  - Outcome: `v0.1.1-rc.1` published on 2026-10-24 with no stored tokens: GitHub prerelease, npm `0.1.1-rc.1` under dist-tag `next` (`latest` stayed `0.1.0`), crates.io prerelease, `upm/` and `godot/` tags only.
- [x] **K3** After the first release: trusted publishing on npm and crates.io, tokens deleted; OpenUPM submission; Godot Asset Library submission. — L9
  - Progress: tokens revoked (2026-10-24); OpenUPM entry approved (2026-10-24); Godot Asset Library entry published as asset 5553 (2026-10-26). Trusted publishing confirmed by K4 (2026-10-24).

## Phase M — Fixes after the first release

- [ ] **M1** Engine speakers at a fixed 48 kHz (issue #21): Godot `MumbleSpeaker.SAMPLE_RATE` and Unity `Mumble.SpeakerSampleRate` (48,000) used by `say`/`Say`, `speak_character`/`SpeakCharacter` and `render_stream`; no read of the device rate; CI runs the Godot tests under four mix rates; README, `docs/guide/concepts.md` (determinism), `docs/bindings/godot.md`, `docs/bindings/unity.md` and the binding READMEs state the scope of bit-identity and the fixed rate. — L4.10, L7.5, L1.4, LD17, LD18
  - Done when, Godot (`run_tests.gd`, each CI run with `MUMBLE_EXPECT_MIX_RATE` set; the test fails if `AudioServer.get_mix_rate()` differs from it):
    - happy path, under mix rates 44,100, 48,000, 22,050 and 96,000: `render_stream("Hello")` has `mix_rate` 48,000 and data equal to the 16-bit encoding of `Mumble.render("Hello", voice, 48000)` (16,800 samples), the same bytes in every run; the same check for a `grunt` and an `alphabet` voice with variation and seed;
    - `speak_character("H")` returns `1 / speed` and the internal player's stream has `mix_rate` 48,000; `speak_character(" ")` plays nothing and returns 1 slot; `say("Hé 👋!")` emits `character_spoken` in order and then `finished` under every mix rate;
    - edge cases: empty text (`render_stream("")` is a 48 kHz stream equal to the encoding of `Mumble.render("", …, 48000)`, `say("")` emits `finished` and no `character_spoken`); a ~1,000-character line (stream length equals the render's sample count at 48 kHz); the 48,000 run is the no-resampling case and matches what a 48 kHz device produced before the change;
    - errors: an invalid voice still logs the error, `speak_character` returns 0 and `render_stream` returns null; no `SampleRateOutOfRange` at any mix rate;
    - the vectors and existing tests still pass in every run.
  - Done when, Unity: `unity-interop` checks `Mumble.SpeakerSampleRate == 48000` and that `Render("Hello", default, SpeakerSampleRate)` has 16,800 samples; review confirms `Runtime/` does not read `AudioSettings.outputSampleRate`; checklist U4 added (run with G3 by whoever verifies Unity).
  - Done when, docs: the site builds (L7.3) and the pages above no longer suggest bit-identity per device without the 48 kHz note (L7.5).

## Phase N — Unity on Android (issue #25)

Design §9.4.1, LD21–LD26. Phase letter N, not L, so task IDs do not look like
requirement IDs.

- [ ] **N1** Android build: `.cargo/config.toml` with the 16 KB `max-page-size` flag for the three Android targets, `scripts/android/build.sh`, `scripts/android/check.sh`, `bindings/unity/build.sh android`. — L4.13, L4.14, LD22, LD23
  - Done when: locally (NDK installed) `bindings/unity/build.sh android` writes the three `Plugins/Android/libs/<abi>/libmumble_ffi.so` and `check.sh` passes on them (happy path: right machine per folder, exports equal to the `mumble.h` functions, every `LOAD` aligned ≥ 16 KB, `DT_NEEDED` only system libraries); `check.sh` fails with a clear message on each negative case: a header with one extra declared function (missing export), a library in the wrong ABI folder (machine mismatch), a library linked with `RUSTFLAGS=-C link-arg=-Wl,-z,max-page-size=4096` (alignment), a missing ABI folder; without `ANDROID_NDK_HOME`/`ANDROID_NDK_ROOT` `build.sh` stops with an error naming the variable; `build.sh` with no argument still builds the desktop library unchanged.
- [ ] **N2** Unity package layout: committed `.meta` files for `Plugins/Android`, `libs`, the three ABI folders and the three `libmumble_ffi.so` (Android only, `CPU` per folder, fixed GUIDs); `scripts/android/check-metas.sh`. — L4.13, LD26
  - Done when: `check-metas.sh` passes on the package; it fails on a copy where an Android `.meta` has the wrong `CPU`, where an Android `.meta` enables Editor or a standalone platform, where a desktop `.meta` enables Android, and where an Android library has no `.meta`; the existing `unity-interop` job still passes (desktop `.meta` files unchanged).
- [ ] **N3** CI `android` job: pinned NDK and `cargo-ndk`, build of the three ABIs, `check.sh` and `check-metas.sh` with their negative self-tests (as in N1, N2), core conformance vectors for `armv7-unknown-linux-gnueabihf` under QEMU; added to the required checks. — L4.14, L5.2, LD23, LD25
  - Done when: the job is green on the PR and its summary lists ABI, size, symbol count and alignment per library; a deliberate break pushed on a scratch commit (one export renamed in `mumble-ffi`, then reverted) makes it fail; the armv7 vector run reports all vectors passed, and fails if one expected hash in a local copy of the vectors is altered.
- [ ] **N4** Device-runnable vectors: `Tests/Runtime` assembly `MumbleSpeech.Tests.Runtime` (all platforms) with `Vectors.cs` and `VectorChecks.cs` moved from `Tests/EditMode` with their `.meta` (GUIDs kept) and a PlayMode test; the EditMode assembly references it; `CSHARP_PATH` in `mumble-conformance` and `DotnetTests~` follow. — L5.2, LD25
  - Done when: the generator writes `Tests/Runtime/Vectors.cs` and the CI freshness check of the generated file still fails when it is stale; `unity-interop` runs every vector from the new path; `verify.sh` still finds a `.meta` for every file; U2 (EditMode) and U7 (player) are the manual checks.
- [ ] **N5** Release: `android` job in `release.yml`, `assemble.sh` copies the libraries into the Unity package only, `verify.sh` checks the three Android libraries and their `.meta` and runs `check.sh` and `check-metas.sh` on the extracted package; release notes (`notes.mjs`) list Android among the Unity package's platforms and in the compatibility table. — L4.13, L4.14, L8.1, L8.3, LD24
  - Done when: a release dry run (pull request trigger) builds the four archives; the Unity tarball contains `Plugins/Android/libs/<abi>/libmumble_ffi.so` and `.meta` for the three ABIs; the C archive and the Godot zip contain no Android files; `verify.sh` fails on a tarball with one Android library removed; the notes preview shows Android for Unity only.
- [ ] **N6** Documentation: `bindings/unity/README.md`, `docs/bindings/unity.md` (Android section: ABIs, API 21+, IL2CPP needed for ARM64 in Unity, Google Play 16 KB), `TESTING.md` with U6–U8, the *Unity verification report* issue form with U6–U8 fields; CHANGELOG *Unreleased* entry. — L4.13, L7.1, L8.4
  - Done when: the `site` job passes (no broken links); the issue form validates (GitHub renders it on the PR branch).
- [ ] **N7** Manual verification on an Android device (checklist U6–U8), by the maintainer or a volunteer through the issue form. — L4.13, L5.2
  - Done when: U6 and U7 pass on at least one ARM64 device; U8 passes or is recorded as not available. Until then the changelog lists Android under *Known issues* as not yet verified on a device, as was done for desktop Unity.

## Phase W — Godot on the web (issue #32)

Design §9.3.1, LD27–LD34. W1 settles the facts the rest depends on (API level,
Emscripten compatibility with the 4.3 template, size); its outcomes go into the
decision log before the pull request is merged.

- [x] **W1** Web build: target-specific `godot` dependencies in `crates/mumble-godot/Cargo.toml`, the `[target.wasm32-unknown-emscripten]` section in `.cargo/config.toml`, `scripts/godot-web/versions.env`, `scripts/godot-web/build.sh`, `bindings/godot/build.sh web`, the two `web.*.wasm32` entries in `mumble_speech.gdextension`, `scripts/godot-web/check-wasm.mjs` with `check-wasm.test.sh` and the `.gdextension` check. — L4.15, L4.17, LD27, LD28, LD29, LD34
  - Done when:
    - happy path: with the pinned nightly and Emscripten, `bindings/godot/build.sh web` writes `addons/mumble_speech/bin/mumble_godot.wasm` and `check-wasm.mjs` passes on it (magic and version, `dylink.0`, no shared memory, no atomics, `gdext_rust_init` exported, within budget), printing raw and gzip size;
    - desktop unchanged: `bindings/godot/build.sh` with no argument and `cargo build --workspace` on stable build as before, and `cargo tree -p mumble-godot -e features` on the host shows `api-4-3` and no `experimental-wasm*`;
    - errors: `build.sh` stops with a message naming the expected version when `emcc` is missing or reports another version; `bindings/godot/build.sh` rejects an unknown argument (exit 2);
    - negatives: `check-wasm.test.sh` makes `check-wasm.mjs` fail on a module without `dylink.0`, one importing shared memory, one without the entry symbol and one over budget, and on an unassigned `0xFD` sub-opcode (the instruction decoder fails closed; every assigned sub-opcode and immediate class is covered); the `.gdextension` check fails on a copy without a web key, with a wrong path, and with a `web.release.threads.wasm32` key;
    - decisions recorded: LD29 states which API mechanism worked (prebuilt `api-4-3` or `api-custom-json`), LD34 the measured sizes and the budget, and LD28 whether the 4.3 and 4.7.2 `dlink` templates load the library (the W4 run); IF 4.3 fails, LQ13 is resolved and L4.15, L4.18 amended in the same pull request.
- [ ] **W2** Speaker clock on the web: `MumbleSpeaker` records the start instant in `say` and uses the wall clock as position when running on the web with an effective *Sample* playback type; audio clock otherwise. — L4.16, LD30
  - Done when:
    - unit tests (`cargo test`, host): the clock choice `wall_clock_for` is tested for desktop, web *Sample*, web *Stream*, web *Default* with both project values, and unknown values (audio clock);
    - desktop: the four mix-rate runs of `run_tests.gd` pass unchanged, and review confirms the desktop path still reads the audio clock (no new public API is added to expose the choice);
    - web (through W3/W4): the L4.16 bounds hold for `say("Hé 👋!")` with audio running and suspended, `finished` is emitted exactly once and after the last `character_spoken`, `say("")` emits only `finished`, and a second `say` during a line restarts the clock (events of the first line are not emitted after the second starts);
    - *Stream* mode on the web (internal player switched in the test) uses the audio clock and meets its bound;
    - `stop()` during a line emits no further signal; a 500-character `type_text` line in Sample mode finishes, and the number of samples registered with the browser after it (read through `JavaScriptBridge` from Godot's audio module, or, if that is not reachable, by GW2) does not grow with the line length.
- [ ] **W3** Shared suite and web runner: `tests/suite.gd` extracted from `run_tests.gd` (desktop output and command line unchanged), `tests/web/runner.tscn` + `runner.gd` with the web-only checks, `export_presets.cfg` (`Web`, `Web (tests)`), the `main_scene.mumble_web_tests` and `rendering_method.web` settings in `project.godot`, `.gitignore` for `build/` and `tests/web/vectors.json`. — L4.15, L4.16, L5.2, LD32
  - Done when: the desktop runs pass with the same number of checks as before the split (printed count compared); the `Web (tests)` export starts the runner and the `Web` export starts the example scene (checked by W4 on both Godot versions; if the feature-tag override of the main scene is not honored on 4.3, the fallback of §9.3.1 is used and recorded in the decision log); the runner prints `MUMBLE_WEB_TESTS FAIL` when one vector's expected hash is altered in a local copy of `vectors.json`, and when the vectors file is missing from the export.
- [ ] **W4** CI: `godot-web-build` and `godot-web` jobs (Godot 4.3 and 4.7.2; Chromium with audio running and suspended), `scripts/godot-web/export.sh`, `run-tests.mjs`, its `package.json` and lockfile (exact Playwright version), template cache, PulseAudio null sink; Firefox and WebKit job (not required); `godot-web` not a required check at first, promoted after ten green runs on `main` (LQ14). — L4.15–L4.17, L5.2, LD31
  - Done when:
    - the jobs are green on the PR, and the summary lists the wasm sizes, the Godot version, the browser, the number of vectors checked and the measured timings of the `say` check;
    - the page is served without COOP/COEP and the run asserts `crossOriginIsolated === false`;
    - negative runs on scratch commits, then reverted: a vector hash altered (fails), the `.wasm` left out of the addon (fails on the export check), the speaker clock forced to the audio clock on the web (the `suspended` run fails on `finished`), the `AudioContext` expected `running` with autoplay blocked (fails on the state check);
    - the Firefox and WebKit job runs and its result (pass, or the failure and its cause) is recorded in the PR description for LQ14.
- [ ] **W5** Release: `godot-web` job in `release.yml` (`web` is the npm package's job), `assemble.sh` adds `mumble_godot.wasm` to the Godot zip only, `verify.sh` checks it (`check-wasm.mjs`, `.gdextension` check, exported tests on Godot 4.3 in Chromium), `notes.mjs` lists the web among the Godot platforms and in the compatibility table, the `godot-addon` README line and Asset Library summary mention the web. — L4.15, L4.17, L8.1, L8.3, L9.4, LD33
  - Done when: a release dry run (pull request trigger) builds the four archives; the Godot zip contains `addons/mumble_speech/bin/mumble_godot.wasm` and the C archive and Unity tarball contain no `.wasm`; `verify.sh` fails on a Godot zip with the `.wasm` removed and on one with a threaded build substituted (a module with shared memory); the notes preview shows *Web (Godot 4.3+, no threads)* for Godot only; `verify.test.sh` covers the new negatives.
- [ ] **W6** Documentation: `bindings/godot/README.md` (drop the stale "no prebuilt release yet" note) and `docs/bindings/godot.md` with a *Web export* section (L4.18: settings, threads off and what happens otherwise, no headers, user gesture, Sample mode timing, measured sizes, `build.sh web` from source); root README platform list; `bindings/godot/TESTING.md` with GW1–GW5; a *Godot web verification report* issue form; CHANGELOG *Unreleased* entry. — L4.18, L7.1, L8.4
  - Done when: the `site` job passes (no broken links); the issue form validates (GitHub renders it on the PR branch); review confirms each L4.18 point is covered, with sizes taken from W1 and the threaded-export behavior from GW4.
- [ ] **W7** Manual verification in browsers (checklist GW1–GW5), by the maintainer or a volunteer through the issue form. — L4.15, L4.16, L5.2 [man]
  - Done when: GW1–GW3 pass in the latest Chrome, Firefox and desktop Safari on Godot 4.3 and on the latest 4.x; GW4 is recorded in the docs; GW5 passes or is recorded as not available. Until then the changelog lists Godot web under *Known issues* as verified in Chromium in CI only.

## Phase T — Godot on the web with threads (issue #34)

Design §9.3.2, LD35–LD41. Phase letter T (threads). T1 settles the facts the
rest depends on (the build mechanism, the threaded library's size, whether the
4.3 threaded template loads it); its outcomes go into the decision log before the
pull request is merged. Desktop builds and the non-threaded web path stay
unchanged.

- [ ] **T1** Threaded web build: the wasm `godot` dependency split by `cfg(target_feature = "atomics")` in `crates/mumble-godot/Cargo.toml`, `scripts/godot-web/build.sh --threads` (`cargo --config` with `-pthread` and `+atomics`, target folder `target/godot-web-threads`, output `mumble_godot.threads.wasm`), `bindings/godot/build.sh web` building and checking both, the two `web.*.threads.wasm32` entries in `mumble_speech.gdextension`, `WASM_THREADS_BUDGET_BYTES` in `versions.env`. — L4.19, L4.20, LD35, LD36, LD37, LD38
  - Done when:
    - happy path (CI, `godot-web-build`): with the pinned nightly and Emscripten, `bindings/godot/build.sh web` writes both `bin/mumble_godot.wasm` and `bin/mumble_godot.threads.wasm`, and `check-wasm.mjs` passes on each in its mode, printing raw and gzip size of both;
    - build mechanism: the verbose log of the threaded build shows the shared flags of `.cargo/config.toml` and `-pthread`, `+atomics` together; `cargo tree -p mumble-godot -e features --target wasm32-unknown-emscripten` shows `experimental-wasm-nothreads` without `+atomics` and not with it; IF either does not hold, the fallback of LD36 or LD37 is used and recorded there;
    - non-threaded unchanged: `scripts/godot-web/build.sh <dir>` without `--threads` gives a library that passes the §9.3.1 checks, with a size within 1 % of the 520,810 bytes of LD34 (same toolchain, same features);
    - desktop unchanged: `bindings/godot/build.sh` with no argument and `cargo build --workspace` on stable build as before, and `cargo tree -p mumble-godot -e features` on the host shows `api-4-3` and no `experimental-wasm*`;
    - errors: `build.sh` rejects an unknown option and a missing out dir (exit 2), and the `emcc` checks of W1 apply to `--threads` too; `build.test.sh` covers `--threads` with the stub cargo (the `--config` argument and the target folder are passed, the copy is named `.threads.wasm`, a failing cargo fails the script);
    - decisions recorded: LD38 states the measured threaded size (raw and gzip) and the budget; LD36 and LD37 state whether the chosen mechanism worked.
- [ ] **T2** Library checks: `check-wasm.mjs --threads` (shared memory imported, atomics present, entry symbol, threaded budget), the name/mode rule, the four-key `.gdextension` check; fixtures and tests. — L4.17, L4.20, LD38
  - Done when:
    - happy path: both CI libraries pass in their modes, and the committed `.gdextension` passes;
    - negatives (`check-wasm.test.sh`, `check-wasm.test.mjs`): a non-threaded module with `--threads`, a threaded one without, shared memory without atomics, atomics without shared memory, a shared memory defined rather than imported, a `.threads.wasm` name without `--threads` and a plain name with it, over the threaded budget, a missing or malformed `WASM_THREADS_BUDGET_BYTES`; `.gdextension` without a threaded key, with the two paths swapped, with an extra `web.release.nothreads.wasm32` key, and the former `threads` key rejection no longer applies;
    - the non-threaded checks and their tests of W1 pass unchanged.
- [ ] **T3** Presets and runner: `Web (threads)` and `Web (threads tests)` in `export_presets.cfg`; `runner.gd` reports `threads`; `export.sh` caches the four `dlink` templates and requires exactly the library of the preset's kind. — L4.19, L5.2, LD39
  - Done when: both threaded presets export on Godot 4.3 and 4.7.2 (through T4), the threaded export folder contains `mumble_godot.threads.wasm` and no `mumble_godot.wasm`, the non-threaded one the reverse; `export.test.sh` covers a threaded preset (template names, the expected file, failure when the wrong or both libraries are present, a cache holding only the non-threaded templates is refilled); the desktop runs of `run_tests.gd` are unchanged (same count); IF `OS.has_feature("threads")` is not reported at runtime on 4.3, the runner reports `null` and LD39 records it.
- [ ] **T4** CI: `run-tests.mjs --threads` (COOP/COEP headers, `crossOriginIsolated === true`, threaded library requested and the other not; the reverse request check without `--threads`), `godot-web-build` building both, the `godot-web-threads (<version>)` matrix job, the threaded runs in `godot-web-browsers`; none required (LQ14). — L4.16, L4.19, L4.20, L5.2, LD39, LD40
  - Done when:
    - the jobs are green on the PR, and the summary lists both library sizes, the Godot version, the browser, threads on or off, the number of vectors checked and the measured timings of the `say` checks (Sample and Stream) in the threaded export;
    - `run-tests.test.mjs` covers the new flag (headers sent on every response, the verdict on `crossOriginIsolated`, `threads` true, false and `null`, the request-log checks in both directions);
    - negative runs on scratch commits, then reverted: the threaded export served without headers (`--threads` with the headers switched off: fails on `crossOriginIsolated`), the `.gdextension` without the threaded keys (the threaded run fails on the request log), the two library files swapped in the addon (fails the library check), a vector hash altered (the threaded run fails);
    - the *Stream*-mode timing in the threaded export is within the L4.16 bound; IF not, LD40 and L4.16 are amended with the measurement in the same pull request;
    - LD35's selection is confirmed on 4.3 and 4.7.2; IF the 4.3 threaded template does not load the threaded library, LQ17 is resolved and L4.18, L4.19 and the release notes amended in the same pull request;
    - the Firefox and WebKit threaded results (pass, or the failure and its cause) are recorded in the PR description for LQ14; the non-threaded `godot-web` jobs stay green.
- [ ] **T5** Release: the `godot-web` job builds and checks both libraries, `native-web` carries both, `assemble.sh` adds both to the Godot zip only, `verify.sh` checks both and runs both kinds of export on Godot 4.3 in Chromium, `notes.mjs` names the web with or without threads. — L4.19, L4.20, L8.1, L8.3, L9.4, LD33, LD35, LD39
  - Done when: a release dry run (pull request trigger) builds the four archives; the Godot zip contains both `.wasm` files and the C archive and Unity tarball none; `verify.sh` fails on a Godot zip without the threaded file and on one with the two files swapped (`verify.test.sh` covers both); the notes preview shows *Web (Godot 4.3+, with or without threads)* for Godot only (`notes.test.mjs`).
- [ ] **T6** Documentation: the *Web export* section of `docs/bindings/godot.md` and `bindings/godot/README.md` as a choice (L4.18, LD41: threads off or on, headers, the symptom without them from GW7, PWA, itch.io, *Run in Browser*, both sizes and template increases, main-thread use), root README platform list if it mentions threads, `bindings/godot/TESTING.md` with GW6–GW8 (GW4 replaced by GW7), a threaded section in the *Godot web verification report* issue form, CHANGELOG *Unreleased* entry. — L4.18, L7.1, L8.4, LD41
  - Done when: the `site` job passes (no broken links); the issue form validates (GitHub renders it on the PR branch); review confirms each L4.18 point is covered, with sizes from T1 and the symptom from GW7 (marked TBD until then).
- [ ] **T7** Manual verification of threaded exports in browsers (checklist GW6–GW8), by the maintainer or a volunteer through the issue form. — L4.18, L4.19, L5.2 [man]
  - Done when: GW6 passes in the latest Chrome, Firefox and desktop Safari on Godot 4.3 (or the threaded minimum of LQ17) and on the latest 4.x; GW7 is recorded in the docs; GW8 passes or is recorded as not available. Until then the changelog lists threaded Godot web exports under *Known issues* as verified in Chromium in CI only.

## Manual checklist

| ID | Steps | Expected | Requirements |
|---|---|---|---|
| G1 | Open `bindings/godot/example` in Godot 4.3, press Play | A line of dialogue appears letter by letter with synchronized sound | L4.6, L4.9 |
| G2 | Create a `MumbleVoice` resource from the inspector and assign it | The parameters change the sound without writing code | L4.6 |
| G3 | Call `say()` on a `MumbleSpeaker` from GDScript | The sentence plays, then `finished` is emitted | L4.6 |
| U1 | Import the package from a local path in Unity 2022.3, open the `Basic` sample | The sample plays without errors in the console | L4.7, L4.9 |
| U2 | Run the EditMode tests | All vectors pass | L5.2 |
| U3 | With TextMeshPro installed, use the typewriter | Text and sound synchronized | L4.7 |
| U4 | Set *Project Settings → Audio → System Sample Rate* to 44,100, then 48,000 (and 22,050 or 96,000 if the device allows); each time call `Say("Hello")` and type a line with `SpeakCharacter` | The clip has `frequency` 48,000 and 16,800 samples every time; `OnCharacter` fires 5 times then `OnFinished`; pitch and tempo sound the same at every setting | L4.10 |
| U5 | Without building, add `bindings/unity/package.json` from a source checkout and call `Say` | The console shows the exception naming the missing library, its `Plugins/` folder and the install options; after installing by git URL, the sample plays | L4.11 |
| U6 | Install the package in Unity 2022.3 or 6 with Android Build Support; select each `Plugins/Android/libs/<abi>/libmumble_ffi.so` in the inspector; build the `Basic` sample for Android (IL2CPP, ARM64 and ARMv7 ticked) and run it on an ARM64 device | Inspector: only Android ticked, with the folder's CPU; the desktop libraries have Android unticked. On the device: the sample speaks and types the lines, no `DllNotFoundException` or `EntryPointNotFoundException` in `adb logcat`. The APK contains `lib/arm64-v8a/` and `lib/armeabi-v7a/libmumble_ffi.so` and no desktop library | L4.13, L4.9 |
| U7 | With `testables` set (U2) and the device connected: Test Runner → PlayMode → *Run All in Player* (Android) | `MumbleSpeech.Tests.Runtime` passes: every conformance vector is bit-identical on the device | L5.2, L1.4 |
| U8 | Optional: run the U6 build on a 32-bit ARM device (or with ARMv7 only) and on an x86_64 emulator or ChromeOS device; open the APK in Android Studio's APK Analyzer | The sample speaks on each; APK Analyzer reports no 16 KB alignment warning for `libmumble_ffi.so` | L4.13, L4.14 |
| GW1 | In `bindings/godot` (after `build.sh web`) or a project with the released addon, export the `Web` preset (Extensions Support on, Thread Support off) with Godot 4.3 and with the latest 4.x; serve `build/web/` with a plain static server (`python3 -m http.server`, no extra headers); open it in the latest Chrome, Firefox and desktop Safari, click once | The example types its line letter by letter with sound in sync, as on desktop; no error in the browser console; `crossOriginIsolated` is `false` in the console | L4.15, L4.9 |
| GW2 | Open the `Web (tests)` export from GW3 in each browser with the speakers on (it says a line and types a 500-character one), with the browser's memory tool open | Each character sounds as its letter appears; the `say` line ends as `finished` is logged (within about a frame plus the browser's output latency); memory returns to its level after the long line | L4.16 |
| GW3 | Export the `Web (tests)` preset; serve and open it in Firefox and Safari, click once | The page console ends with `MUMBLE_WEB_TESTS PASS`: every conformance vector is bit-identical in the browser and the timing checks pass | L5.2, L1.4, L4.16 |
| GW4 | Export the `Web` preset with Thread Support on; serve it with and without COOP/COEP headers | Record what happens (export error, load error, or silent failure) and check the docs describe it. *Replaced by GW7 once the threaded library ships (issue #34)* | L4.18 |
| GW5 | Optional: open the GW1 export on iOS Safari, and upload it to itch.io as an HTML game (embedded in the page, *SharedArrayBuffer support* off) | The line speaks after a tap, as in GW1 | L4.15 |
| GW6 | After `build.sh web` (or with the released addon), export the `Web (threads)` and `Web (threads tests)` presets with Godot 4.3 and with the latest 4.x; serve each with COOP `same-origin` and COEP `require-corp` (the editor's *Run in Browser*, or a static server that sets them); open them in the latest Chrome, Firefox and desktop Safari, click once | `crossOriginIsolated` is `true`; the network panel shows `mumble_godot.threads.wasm` loaded and not `mumble_godot.wasm`; the example types its line with sound in sync as in GW1; the tests page ends with `MUMBLE_WEB_TESTS PASS` and reports threads on; the non-threaded GW1 export still loads `mumble_godot.wasm` | L4.19, L4.16, L5.2 |
| GW7 | Serve the `Web (threads)` export of GW6 without the headers (`python3 -m http.server`) and open it in Chrome and Firefox | Record what the page shows (Godot's error about cross-origin isolation or `SharedArrayBuffer`, or another failure) and check the docs describe it and the fixes | L4.18 |
| GW8 | Optional: upload the `Web (threads)` export to itch.io with *SharedArrayBuffer support* on, and the `Web (threads)` export with the PWA option (*Progressive Web App* on, *Ensure Cross Origin Isolation Headers* on) to a static host without headers | Both speak after a click (the PWA one after the reload its service worker triggers); with itch.io's option off, the GW7 symptom appears | L4.18, L4.19 |

## Verifiability on this machine

- Available: Rust 1.97, Node 26, CMake, clang. To install: target
  `wasm32-unknown-unknown`, `wasm-bindgen-cli`, `cbindgen`.
- Not available: Godot, Unity, .NET. Godot is verified in CI (headless) and
  with G1–G3 by you; Unity only with U1–U3 by you.
- Not available: Emscripten, a Rust nightly, Playwright browsers. The Godot web
  build and its browser tests are verified in CI (W4, T4) and with GW1–GW8 by you.
- Available since 2026-11-07: the Godot 4.7.2 desktop editor
  (`/Applications/Godot.app`), enough to open the project and its export presets;
  the web export templates are not installed, so web exports run in CI.
- Windows and Linux are verified only in CI.

## Traceability

| Requirement | Task |
|---|---|
| L1 | B1–B5, C2 |
| L2 | B4, B5 |
| L3 | B4 |
| L4.1–L4.2 | D1, D2 |
| L4.3–L4.5 | E1, E2 |
| L4.6 | F1–F3 |
| L4.7 | G1–G3 |
| L4.13–L4.14 | N1–N7 |
| L4.15–L4.18 | W1–W7, T2 (L4.17), T6–T7 (L4.18) |
| L4.19–L4.20 | T1–T7 |
| L4.8–L4.9 | F2, G2, H2 |
| L4.10 | M1 |
| L4.11–L4.12 | G4 |
| L5 | C1, C2, D2, E2, F2, G2, H1, N3, N4, N7, W3, W4, W7, T3, T4, T7 |
| L7 | J1–J3, M1 (L7.5), W6, T6 |
| L8 | H1, H3, H4, N5, W5, T5, T6 (L8.4) |
| L9 | K1–K3, H3, W5, T5 (L9.4) |
| L6 | A1b, A2, D3, P1–P3 |
