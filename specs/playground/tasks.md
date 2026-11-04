# Implementation plan

Each task is small, closes with green tests and cites the requirements it covers.
Core tasks are written test-first. The order respects dependencies.

Legend: **Done when** = verifiable condition for closing the task.

## Phase 0 — Setup

- [x] **T0.1** Scaffold Vite `vanilla-ts`, TypeScript `strict`, Vitest, scripts `dev`, `build`, `test`, `typecheck`.
  - Done when: `npm test` and `npm run build` pass on an empty project.
- [x] **T0.2** Folder structure as in design §2 and `core/types.ts` with the types from design §3.
  - Done when: `npm run typecheck` passes.

## Phase 1 — Pure core

- [x] **T1.1** `normalize` + `tokenize` (grapheme, 6 categories). — R1.4, R1.5
  - Done when: tests on accented letters, punctuation, line breaks, composite emoji, non-Latin alphabets.
- [x] **T1.2** `fnv1a` + `mulberry32`. — R3.8
  - Done when: same seed → same sequence; values in `[0, 1)`; tests with fixed expected values.
- [x] **T1.3** `buildTimeline` with a dummy style. — R3.6, R3.7, R4.2, R4.3, R7.4
  - Done when: tests on pause durations, absence of overlaps, transposition, variation limits, total duration, `Math.random` never called.
- [x] **T1.4** Helper `hasAudibleTokens(tokens)`. — R1.3
  - Done when: `false` for `""`, `"   "`, `"...!?"`; `true` for `"a"`.

## Phase 2 — Styles

- [x] **T2.1** `beep` style. — R3.1, R6.2
  - Done when: with variation 0 all frequencies are identical; all dots the same.
- [x] **T2.2** `grunt` style. — R3.2, R3.3, R6.2
  - Done when: 4 distinct grunts; never two identical consecutive ones over 200 random texts; all 4 used on a long text.
- [x] **T2.3** `alphabet` style. — R3.4, R3.5, R6.2
  - Done when: 26 distinct `SoundSpec`s; same letter → same sound; digits and `other` → neutral sound; 26 distinct colors.
- [x] **T2.4** Registry and snapshot of the `"Hello, world!"` timeline for each style. — R3.8
  - Done when: the snapshots are committed and stable across two runs.
- [ ] **T2.5** Revision of `alphabet` after listening feedback: Italian vowels with 3 cascaded formants, each vowel sounds as itself, pitch within ±1 semitone, speech-like glide. — R3.9, R3.10 (D9)
  - Done when: a spectral test recognizes each of the 5 vowels among the other 4; a test verifies the pitch offset; listening to `a e i o u` at low speed (M10).

## Phase 3 — Audio

- [x] **T3.1** `encodeWav`. — R7.1, R5.5
  - Done when: header verified byte by byte; length = 44 + 2·n; clamping of out-of-range values; a decoding round-trip returns the samples within 1 LSB.
- [x] **T3.2** `synthesize`: pure DSP (PolyBLEP oscillators, formants, glide, noise, envelope, peak limiting). — R5.4, R5.5, design §6.1 (D6)
  - Done when: tests on determinism, frequency, glide, silence between events, absence of clicks, peak ≤ 0.98, 500 characters under 250 ms.
  - Note: the first version with `OfflineAudioContext` took 1.4–9.5 s for 500 characters on Chrome and was replaced (D6).
- [x] **T3.3** `Player` (play/stop/position, synchronous `unlock()`, latency compensation). — R5.1, R5.2, R8.4 (D7)
  - Done when: checklist M1 passes (verified in headless Chrome; real listening remains in T5.1).
- [x] **T3.4** `filename` for the export. — R7.3
  - Done when: test with fixed date → `mumble-beep-20261019-163000.wav`.

## Phase 4 — UI

- [x] **T4.1** Markup and CSS (theme, responsive layout, style cards, sliders). — R2.1, R2.2, R4.1, R6.4, R8.7
- [x] **T4.2** Application state and wiring of the controls (stop on every change, counter, R1.3 message). — R1.1–R1.3, R2.3, R4.4, R4.5, R5.3
- [x] **T4.3** Static visualizer (tokens, dots, colors, sizes). — R6.1, R6.2
- [x] **T4.4** Highlight synchronized with rAF + reduced motion. — R6.3, R6.5
- [x] **T4.5** WAV export from cached samples. — R7.1, R7.2
  - Done when: a unit test verifies that the export does not call synthesis again if the cache is valid.
- [x] **T4.6** Accessibility: fieldset/radio, `<output>`, `aria-pressed`, `aria-live`, visible focus. — R8.3

## Phase 5 — Verification and release

- [ ] **T5.1** Full manual checklist (below) on Chrome, Firefox, Safari, iOS Safari. — R8.2
- [x] **T5.2** Measurement of the gzip bundle. — R8.6
  - Outcome: JS 4.7 KB + CSS 5.1 KB gzip (limit 50 KB).
- [x] **T5.3** Check in the Network panel: no requests after load. — R8.1
  - Outcome: zero requests during play and export (headless Chrome).
- [x] **T5.4** Static deploy (see Q4 in requirements).
  - Outcome: published at https://mumble-speech.github.io/playground/ with the documentation site (library L7.2, LD15), not on the personal account's Pages because of its custom domain.

## Phase 6 — Migration to the library

Depends on the library's task D3 ([`../tasks.md`](../tasks.md)): package
`@mumble-speech/web` available in the npm workspace.

- [x] **P1** Add `@mumble-speech/web` as an npm workspace dependency and replace core, styles, synthesis and WAV with the package API. The player becomes `WebAudioPlayer`. — R1–R8
- [x] **P2** Remove `src/core`, `src/styles`, `src/audio/synth.ts`, `src/audio/wav.ts`, `src/audio/player.ts` and the tests migrated to the library; the UI, cache and file name tests remain. Update design §3–§6 to a reference. — R8.5
- [ ] **P3** Repeat the manual checklist M1–M10; verify the R8.6 budget (JS + CSS under 50 KB gzip, WASM excluded). — R8.6
  - Automated part (headless Chrome, 2026-10-24): every grapheme highlighted in all three styles (accents and emoji included), stop on slider change, M9, WAV export at 44,100 Hz, 320 px without overflow, no network requests. First click 304 ms (includes `AudioContext` start-up in headless Chrome), later clicks 24–93 ms: confirm R5.4 by hand.
  - R8.6: production JS 58.2 KB gzip, of which about 52 KB is the inlined WASM (library LD12, budget L4.2), so about 6 KB of playground JS plus 5.1 KB of CSS.
  - Still to do by hand: listening (M4, M10), M1, M3, M7, M8 and the four browsers.

## Phase 7 — Shareable URL (issue #20)

- [ ] **T7.1** `src/ui/share-url.ts`: `Settings`, `DEFAULT_SETTINGS`, `parseSettings`, `serializeSettings`, with the slider limits and steps in one table shared with `controls.ts`. — R9.1, R9.3, R9.5–R9.10 (design §7.6, D12–D14)
  - Done when: `tests/share-url.test.ts` passes with at least these cases:
    - **Round trip**: for each style and a sample of pitch/speed/variation values (the extremes, the defaults, `variation=0.05` and `0.95`), `parseSettings(serializeSettings(s, ''))` returns `s` and `present = true`.
    - **Canonical form**: the defaults serialize to exactly `?text=Hello&style=beep&pitch=0&speed=15&variation=0`; `-3`, `0.05`, `1` are written in shortest form; owned keys come first in fixed order, followed by non-owned pairs in original order (`?utm=x&text=a` → `?text=a&style=…&variation=0&utm=x`).
    - **No parameters**: `''` and `?foo=1` → defaults with `present = false`.
    - **Missing parameters**: `?text=Hi` → text `Hi`, everything else default, `present = true`.
    - **Malformed numbers** → default: `pitch=`, `pitch=abc`, `pitch=NaN`, `pitch=Infinity`, `pitch=0x10`, `pitch=1e3`, `pitch=+3`, `pitch=%203`, `pitch=.5`.
    - **Out of range** → clamp: `pitch=99` → 12, `pitch=-99` → −12, `speed=0` → 5, `speed=100` → 30, `variation=2` → 1, `variation=-1` → 0.
    - **Off step** → nearest step, ties up: `pitch=2.4` → 2, `pitch=2.5` → 3, `pitch=-2.5` → −2, `variation=0.33` → 0.35, `variation=0.12` → 0.1; no floating-point residue in the serialization (`0.35`, not `0.35000000000000003`).
    - **Style**: `grunt` and `alphabet` accepted; `Grunt`, `robot`, `` (empty) → `beep`.
    - **Text, empty**: `?text=` → `''` (not `Hello`), and `''` serializes as `text=`.
    - **Text, Unicode**: accented letters, CJK, emoji with ZWJ and skin tone (`👩🏽‍🚀`), combining marks, `&`, `=`, `+`, `%`, `#`, `?`, and `\n` survive the round trip; `+` and `%20` both parse as a space; `%E0%A4%A` and `%FF` parse to text with U+FFFD and do not throw.
    - **Line breaks**: `%0D%0A` and `%0D` parse as `\n`.
    - **Max length**: 500 code units kept intact; 501 truncated to 500; 499 ASCII + one emoji (501 code units) truncated to 499 (no lone surrogate); the counter value R1.2 equals `text.length` after parsing.
    - **Duplicates**: `?pitch=3&pitch=5` → 3; `?pitch=abc&pitch=5` → default (first occurrence wins, R9.8); the serialization contains each owned key once.
- [ ] **T7.2** `createUrlSync` and wiring in `main.ts` and `createControls(settings)`. — R9.2, R9.4, R9.11, R9.12 (design §7.2, §7.6, D11)
  - Done when: unit tests with fake timers and a fake `history`/`location` verify: ten `schedule` calls within 250 ms → one `replaceState` with the last settings; `replaceState` is never `pushState`; the path (`/playground/` and `/`) and the fragment are preserved; no call when the query is already canonical; a `replaceState` that throws `SecurityError` is swallowed and the next `schedule` writes the URL; `flush` writes immediately. `npm run typecheck`, `npm test` and `npm run build` pass.
- [ ] **T7.3** Manual verification and changelog. — R9.2, R9.4, R9.12
  - Done when: checklist M11–M13 passes on the deployed preview or `vite preview --base /playground/`; `CHANGELOG.md` *Unreleased* has an *Added* entry for shareable playground links (L8.4, specs rule 6).

## Manual checklist

*Headless* column: outcome of the automated verification in headless Chrome on
2026-10-19 (`playwright-core`, script not included in the repo). It does not replace
manual verification: the audio was not listened to.

| ID | Steps | Expected | Requirements | Headless |
|---|---|---|---|---|
| M1 | Play on `Hello`, then Stop halfway | Audio starts < 300 ms, stops immediately, button returns to *Play* | R5.1, R5.2, R5.4 | ✓ 30–180 ms, 125 ms with 500 characters |
| M2 | Play, then modify text / style / slider | Playback stops every time | R4.5, R5.3 | ✓ slider |
| M3 | Play 500 characters at speed 30 | Highlight stays aligned with the audio until the end | R6.3, R5.4 | ✓ partial: all letters highlighted on short text |
| M4 | Listen to the 3 styles on `Hello` | Uniform beep; grunts varied and never repeated; letters recognizably different | R3.1–R3.4 | — requires listening |
| M5 | Export and open the file in an external player | Sound identical to the one in the page, correct file name | R7.1–R7.3 | ✓ RIFF/WAVE header and name; listening comparison to be done |
| M6 | Window at 320 px | No horizontal scrolling, cards in a column | R6.4 | ✓ |
| M7 | Keyboard only from start to finish | All controls reachable and activatable, visible focus | R8.3 | — |
| M8 | Enable reduced motion from the operating system | Highlight without scale animations | R6.5 | — |
| M9 | Text `"... !!!"` | Play/Export disabled, message visible | R1.3 | ✓ |
| M10 | `alphabet` style, speed 5, text `a e i o u` | The five Italian vowels are recognizable; the letters have almost the same note | R3.9, R3.10 | — requires listening |
| M11 | Set text `Ciao 👋`, style `grunt`, pitch −3, speed 20, variation 0.25; copy the address bar; open it in another browser | Same controls and same sound; no autoplay; the URL keeps `/playground/` | R9.1, R9.4, R9.12 | — |
| M12 | Type a sentence and drag every slider, then press *Back* | The address bar follows the changes; *Back* leaves the page in one step; no errors in the console | R9.2, R9.11 | — |
| M13 | Network panel open while typing and dragging | No requests; no reload | R9.12, R8.1 | — |

## Traceability

| Requirement | Task |
|---|---|
| R1 | T1.1, T1.4, T4.2 |
| R2 | T4.1, T4.2 |
| R3 | T1.3, T2.1–T2.5 |
| R4 | T1.3, T4.1, T4.2 |
| R5 | T3.1–T3.3, T4.2 |
| R6 | T2.x, T4.3, T4.4 |
| R7 | T1.3, T3.1, T3.4, T4.5 |
| R8 | T0.1, T1.x, T3.3, T4.6, T5.x |
| R9 | T7.1–T7.3 |
