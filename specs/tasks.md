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
- [ ] **H3** First release `v0.1.0`, only with the user's go-ahead. — L8.1, L9
- [ ] **K3** After the first release: trusted publishing on npm and crates.io, tokens deleted; OpenUPM submission; Godot Asset Library submission. — L9

## Manual checklist

| ID | Steps | Expected | Requirements |
|---|---|---|---|
| G1 | Open `bindings/godot/example` in Godot 4.3, press Play | A line of dialogue appears letter by letter with synchronized sound | L4.6, L4.9 |
| G2 | Create a `MumbleVoice` resource from the inspector and assign it | The parameters change the sound without writing code | L4.6 |
| G3 | Call `say()` on a `MumbleSpeaker` from GDScript | The sentence plays, then `finished` is emitted | L4.6 |
| U1 | Import the package from a local path in Unity 2022.3, open the `Basic` sample | The sample plays without errors in the console | L4.7, L4.9 |
| U2 | Run the EditMode tests | All vectors pass | L5.2 |
| U3 | With TextMeshPro installed, use the typewriter | Text and sound synchronized | L4.7 |

## Verifiability on this machine

- Available: Rust 1.97, Node 26, CMake, clang. To install: target
  `wasm32-unknown-unknown`, `wasm-bindgen-cli`, `cbindgen`.
- Not available: Godot, Unity, .NET. Godot is verified in CI (headless) and
  with G1–G3 by you; Unity only with U1–U3 by you.
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
| L4.8–L4.9 | F2, G2, H2 |
| L5 | C1, C2, D2, E2, F2, G2, H1 |
| L7 | J1–J3 |
| L8 | H1, H3, H4 |
| L9 | K1–K3, H3 |
| L6 | A1b, A2, D3, P1–P3 |
