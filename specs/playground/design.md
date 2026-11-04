# Design

References to requirements in square brackets, for example [R3.8].

> **Note (library):** §3–§6 (data model, algorithms, styles, synthesis, WAV)
> describe the current TypeScript core. The reference for behavior is
> now the library's [`../design.md`](../design.md); with P1–P3 this
> code is replaced by `@mumble-speech/web` and these sections are reduced
> to a pointer.

## 1. Stack

| Area | Choice | Rationale |
|---|---|---|
| Build | Vite, `vanilla-ts` template | Zero framework, small bundle [R8.6] |
| Language | TypeScript `strict` | Explicit data model |
| Test | Vitest (`node` environment) for UI logic | Sound and timeline are tested in the library |
| Audio | `@mumble-speech/web` (WASM core) + `AudioContext` only for playback | No assets [R8.1]; one implementation shared with every binding (library L1.1) |
| Font | Pixelify Sans self-hosted via `@fontsource` (D8) | No network at runtime [R8.1] |

Runtime dependencies: `@mumble-speech/web` (npm workspace) and the font.

## 2. Architecture

```
text + voice ──► timeline(text, voice) ──► Timeline ──► Visualizer (dots, highlight)
             └─► render(text, voice, 44100) → samples ─┬─► WebAudioPlayer
                    (cached per input, R7.2)            └─► encodeWav → Blob → download
```

Key decision: **playback and export use the same samples**, rendered once per
input snapshot and cached (D1). `WebAudioPlayer` plays them; the highlight
compares its latency-compensated `position()` with the events' `start` (D7).

### Module structure

```
src/
  audio/
    cache.ts        # memoizes the render of the current input snapshot [R7.2]
  ui/
    controls.ts     # textarea, styles, sliders, buttons
    styles.ts       # text of the style cards [R2.1]
    visualizer.ts   # graphemes + dots + highlight, matched by UTF-16 offset
    event-at.ts     # event sounding at a time [R6.3]
    filename.ts     # export file name [R7.3]
    share-url.ts    # settings <-> query string, URL sync [R9]
  main.ts           # composition and state
  style.css
tests/ui.test.ts    # cache, eventAt, file name
tests/share-url.test.ts  # parse, serialize, URL sync [R9]
```

The first version had its own TypeScript core (`src/core`, `src/styles`,
`src/audio/synth.ts`, `wav.ts`, `player.ts`); P1–P2 replaced it with the library.

## 3–6. Data model, algorithms, styles and audio

Since P1–P2 these live in the library: see [`../design.md`](../design.md) §2
(API), §4 (algorithms), §5 (styles), §6 (synthesis), §7 (WAV) and §9.1 (the
`@mumble-speech/web` package). The playground uses only that package's public
API (L6.1):

| Need | Package API |
|---|---|
| Events and dots for the visualizer, `audible` for R1.3 | `timeline(text, voice)`; audible = at least one event |
| Audio for playback and export | `render(text, voice, 44100)` (R7.1 rate) |
| WAV file | `encodeWav(samples, 44100)` |
| Playback and position | `WebAudioPlayer` (`unlock`, `play`, `stop`, `position`) |

What stays here is UI logic: the style cards' text (`src/ui/styles.ts`), the
render cache keyed by an immutable input snapshot (`src/audio/cache.ts`, R7.2),
`eventAt` for the highlight (`src/ui/event-at.ts`) and the export file name.

The visualizer splits the text into graphemes with `Intl.Segmenter` and matches
events to cells by **UTF-16 offset** (`utf16Start`), not by grapheme index, so
a browser with a different Unicode version than the core cannot put a dot under
the wrong letter.

## 7. UI

### 7.1 Layout

```
┌───────────────────────────────────────────────┐
│ Mumble Speech                                 │
│ ┌───────────────────────────────────────────┐ │
│ │ Hello                              5/500  │ │
│ └───────────────────────────────────────────┘ │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │1 Beep    │ │2 Grunt   │ │3 Alphabet│  ← radio│
│ │Undertale │ │Banjo-K.  │ │Animal C. │        │
│ └──────────┘ └──────────┘ └──────────┘        │
│ Pitch  ───●───  0 st                          │
│ Speed  ────●──  15 c/s                        │
│ Var.   ●──────  0.00                          │
│                                               │
│    H   e   l   l   o                          │
│    ●   ●   ●   ●   ●                          │
│                                               │
│ [ ▶ Play ]   [ ⤓ Export WAV ]                 │
└───────────────────────────────────────────────┘
```

On narrow screens the style cards go into a column [R6.4].

### 7.2 Application state

```ts
interface AppState {
  text: string;
  style: StyleId;
  voice: Voice;
  timeline: Timeline;          // derived, recomputed on every input
  playback: 'idle' | 'rendering' | 'playing';
}
```

Every change of `text`, `style` or `voice` → stop [R4.5, R5.3] → new
`timeline` → invalidation of the audio cache → redraw of the visualizer →
debounced URL update [R9.2] (§7.6). Recomputing the timeline is synchronous and
costs O(n) over 500 characters, so no debounce there. Synthesis happens only on
*Play* or *Export*.

The initial values of the controls come from the URL [R9.4], not from the
markup: `main.ts` parses `location.search` before creating the controls and
passes the result to `createControls`, which writes it into the textarea, the
radios and the sliders (and their `<output>`s).

### 7.3 Visualizer [R6.1–R6.5]

- Each token is a `<span>`; consecutive non-space tokens are grouped into
  a `.word` so that wrapping happens between words (a word longer than the line
  still wraps inside itself). Sounding tokens contain a dot
  (`<i>`) with `--dot-color` and a size class.
- Highlight: a `requestAnimationFrame` loop active only during `playing`
  finds the event with `start ≤ position() < start + duration` (binary search) and
  sets `data-active` on the token. Spaces remain visible as gaps.
- With `prefers-reduced-motion: reduce` no `transform: scale`, only color.
- Dot colors and sizes come from the event's sound identifier (library LD14),
  mapped in `src/ui/dots.ts` [R6.2]:

  | Style | Variant | Color | Size |
  |---|---|---|---|
  | `beep` | 0 | `--teal` | `md` |
  | `grunt` | 0 / 1 / 2 / 3 | `--teal` / `--blue` / `--olive` / `--orange` | `sm` / `md` / `lg` / `md` |
  | `alphabet` | `n` = 0–25 | `hsl(round(n × 360 / 26) 55% 55%)` | `md` |
  | `alphabet` | 26 (neutral) | `--muted` | `md` |
- The container has `aria-hidden="true"`: the text is already in the textarea, and the
  visualization is decorative.

### 7.4 Accessibility [R8.3]

- Styles as a `<fieldset>` of native radios with cards as `<label>`.
- Sliders `<input type="range">` with associated `<output>`.
- Play/Stop button with `aria-pressed` and changing text.
- R1.3 message in an `aria-live="polite"` region.

### 7.5 Theme [R8.7]

CSS variables: `--bg #000`, `--card #0b0d0f`, `--border #2a2d31`,
`--text #f2f2f2`, `--muted #9aa0a6`, `--teal #3f8f78`, `--blue #3f6fc4`,
`--olive #7d8f45`, `--orange #b85a33`.

### 7.6 Shareable URL [R9]

**Parameters** (D12). Full words, the same names as the UI labels and the
library's `Voice` fields, so no mapping table is needed:

| Parameter | Setting | Values | Default | Invalid → |
|---|---|---|---|---|
| `text` | Text | any string, ≤ 500 UTF-16 code units after normalization | `Hello` (only when missing) | truncated [R9.7] |
| `style` | Style | `beep` \| `grunt` \| `alphabet` | `beep` | default [R9.6] |
| `pitch` | Pitch | integer −12…12 | `0` | clamp + round, or default [R9.5] |
| `speed` | Speed | integer 5…30 | `15` | clamp + round, or default [R9.5] |
| `variation` | Variation | 0…1, step 0.05 | `0` | clamp + round, or default [R9.5] |

Example: `https://mumble-speech.github.io/playground/?text=Hello%2C+world%21&style=grunt&pitch=-3&speed=15&variation=0.25`.

**Module** `src/ui/share-url.ts`, pure except for `createUrlSync`, testable in
Node (Vitest) with `URLSearchParams`:

```ts
interface Settings { text: string; style: StyleId; pitch: number; speed: number; variation: number }

const DEFAULT_SETTINGS: Settings;          // R1.1, R2.2, R4.1; ranges and steps shared with controls.ts

/** `present` = at least one settings parameter in `search` (R9.4). */
function parseSettings(search: string): { settings: Settings; present: boolean };

/** Canonical query string (with leading `?`) for `settings`, keeping the
 *  parameters of `search` that the playground does not own (R9.3, R9.10). */
function serializeSettings(settings: Settings, search: string): string;

/** Debounced `history.replaceState` (R9.2, R9.11). `history`, `location` and
 *  the timer are injected so tests run with fakes. */
function createUrlSync(deps: { history: History; location: Location; delayMs?: number }): {
  schedule(settings: Settings): void;   // restarts the timer
  flush(): void;                        // writes now (used on load, R9.4)
};
```

**Parsing.** `new URLSearchParams(search)` does the decoding (`+` and `%20` as
space, invalid sequences to U+FFFD, R9.9) and `get()` returns the first
occurrence (R9.8). Numbers must match `^-?\d+(\.\d+)?$` (otherwise default),
then are clamped and snapped with `round(v / step) × step` (`Math.round`, ties
up); variation is computed as `Math.round(v × 20) / 20` to avoid floating-point
residue (R9.5). Text: `\r\n` and lone `\r` → `\n`, then cut at 500 code units
and drop a trailing high surrogate (R9.7). Slider limits and steps are taken
from one table shared with `controls.ts` (the markup's `min`/`max`/`step` must
match it), so URL values and slider values cannot disagree.

**Serialization.** A new `URLSearchParams` with the five owned keys in fixed
order, `String(n)` for numbers (shortest form: `-3`, `0.05`), then every
non-owned pair of the old `search` in order (R9.10). `URLSearchParams.toString()`
does the UTF-8 percent-encoding (R9.9). An empty text is written as `text=`.

**Hook.** `main.ts`:

1. on start, `parseSettings(location.search)` → `createControls(settings)`; if
   `present`, `flush()` writes the canonical URL once (R9.4);
2. in the `controls.onChange` handler (user changes only, not the initial `onInputChange` call at startup, which would rewrite a parameterless URL against R9.4), `urlSync.schedule(settings)` (R9.2).

Playback is not involved in either step (R9.12).

**Writing the URL.** `history.replaceState(history.state, '', location.pathname
+ query + location.hash)`: the path is read from `location`, never from a
constant, so the page works both at `/` (`vite dev`) and under `/playground/`
(`--base /playground/` in `build:site`) [R9.3]. The call is skipped when the
query string is already the canonical one, and is wrapped in `try/catch`: a
`SecurityError` (Safari allows about 100 calls per 10 s; Chrome throttles
navigation floods) is ignored and the next `schedule` retries [R9.11].

**Debounce.** 250 ms trailing (D11): a slider drag or fast typing fires dozens of
`input` events per second, which would hit the browser limits above; 250 ms is
short enough that the address bar is current by the time the user reaches it
(R9.2 bound: 500 ms).

**Privacy.** The text is in the URL, so it ends up in the browser history and,
when someone opens a shared link, in the request to the static host (GitHub
Pages). `replaceState` makes no request, so nothing leaves the browser while
typing [R9.12]; the page still makes no network calls after loading [R8.1].
Accepted for the playground (D10).

## 8. Test strategy

| Level | What | Requirements |
|---|---|---|
| Library (core, WASM, vectors) | sound, timeline, styles, WAV, determinism, performance: see the library's test strategy | R1.4, R1.5, R3.x, R4.2, R4.3, R5.5, R7.1, R7.4 |
| Unit (Vitest, node) | render cache, `eventAt`, export file name | R6.3, R7.2, R7.3 |
| Unit (Vitest, node) | `parseSettings`, `serializeSettings`, `createUrlSync` with fake history and timers | R9.1–R9.11 |
| Smoke (headless Chrome, not in the repo) | play, highlight of every grapheme (accents, emoji), stop on change, export, 320 px layout, no requests | R5, R6, R7, R8.1, M2, M6, M9 |
| Manual | checklist in `tasks.md` (audio, sync, browsers, a11y) | the rest |

R7.2 is guaranteed by the architecture (same samples) and verified with a test
that checks that the export uses the cached samples.

## 9. Decision log

| # | Decision | Rejected alternative | Rationale |
|---|---|---|---|
| D1 | Offline render for playback too | Live scheduling on `AudioContext` | A single code path, identical export, simple sync |
| D2 | Seed derived from style + text | Random seed per session | Determinism and reproducible tests |
| D3 | Sounds ≤ 0.9 slot | Overlaps allowed | No clipping from summing, simpler timeline |
| D4 | Vowel mapping from the English name of the letters, for consonants only (revised by D9) | Arbitrary mapping | Closer to Animalese, explainable rule |
| D5 | ×3 makeup on the formants | No compensation | A narrow band-pass lets through roughly one harmonic: without makeup `grunt` and `alphabet` are much quieter than `beep` |
| D6 | DSP synthesis in TypeScript (replaces the `OfflineAudioContext` graph) | `OfflineAudioContext` | Measured on Chrome: 1.4–9.5 s for 500 characters, because the nodes stay active for the whole duration (cost O(events × duration)), so it violates R5.4. Direct synthesis is linear, testable in Node and identical across browsers |
| D7 | Highlight compensated by `outputLatency` | Raw `currentTime` | With Bluetooth headphones latency reaches 100–200 ms, beyond the R6.3 limit |
| D8 | Pixelify Sans instead of Silkscreen | Silkscreen | Silkscreen has only uppercase and small caps; the reference shows real lowercase |
| D9 | `alphabet`: vowels with 3 cascaded formants, each vowel sounds as itself, almost constant pitch | 2 narrow parallel band-passes, vowels from the English name, ±6 semitones between letters | Listening feedback: it did not sound like Animal Crossing and the vowels were not recognizable (the `a` sounded "e", the `i` sounded "a"). The narrow band-passes whistle, the cascade gives credible vowels; the note jumps made the result sound like a melody |
| D10 | Settings in the query string (`?text=…`) | Fragment (`#text=…`), not sent to the server | Issue #20 asks for GET parameters; query strings are the familiar shape for shared links and survive tools that strip fragments. The cost is that a shared text reaches the static host's request logs; acceptable for a demo page that stores nothing (§7.6 *Privacy*) |
| D11 | `history.replaceState`, debounced 250 ms | `pushState` per change; no debounce | One history entry per keystroke or slider step would make *Back* useless; undo inside the page is not a goal. Without debounce, slider drags exceed Safari's and Chrome's History API rate limits |
| D12 | Full-word parameter names (`text`, `style`, `pitch`, `speed`, `variation`); all five always written, defaults included | The issue's `p`/`s`/`v`/`t`; omitting defaults | Single letters are ambiguous (`s` = style or speed?) and save ~25 characters on a URL dominated by the text. Writing the defaults keeps a shared link sounding the same even if a future revision changes a default |
| D13 | No seed in the URL | A `seed` parameter | The playground has no seed control and always uses the library default 0, so the seed does not vary between links. A hidden URL-only setting would make two identical-looking pages sound different. A future seed control adds a `seed` parameter (default 0, so old links keep their sound) |
| D14 | Out-of-range or off-step numbers are clamped and rounded; malformed ones fall back to the default | Reject the whole URL; ignore only out-of-range values | A hand-edited or truncated link still opens with the closest sound. Clamping and step rounding are exactly what the range input does to an out-of-range value, so the URL and the slider agree |
