# Design

References to requirements in square brackets, for example [R3.8].

> **Note (library):** §3–§6 (data model, algorithms, styles, synthesis, WAV)
> describe the current TypeScript core. The reference for behavior is
> now `specs/design.md` of the `mumble-speech` library; with P1–P3 this
> code is replaced by `@mumble-speech/web` and these sections are reduced
> to a pointer.

## 1. Stack

| Area | Choice | Rationale |
|---|---|---|
| Build | Vite, `vanilla-ts` template | Zero framework, small bundle [R8.6] |
| Language | TypeScript `strict` | Explicit data model |
| Test | Vitest (`node` environment for core and synthesis) | Core and synthesis are pure [R8.5] |
| Audio | DSP synthesis in TypeScript + `AudioContext` only for playback | No assets [R8.1], linear cost [R5.4] (D6) |
| Font | Pixelify Sans self-hosted via `@fontsource` (D8) | No network at runtime [R8.1] |

No runtime dependencies other than the font.

## 2. Architecture

One-way pipeline. Everything to the left of `Player` and of the download
is pure and testable in Node.

```
text ───► normalize ──► tokenize ──► buildTimeline(style, voice, seed) ──► Timeline
                                                                            │
                                     ┌──────────────────────────────────────┤
                                     ▼                                      ▼
                     synthesize(Timeline) → Float32Array              Visualizer
                           │            │                          (dots, highlight)
                           ▼            ▼
                        Player       encodeWav → Blob → download
```

Key decision: **playback and export use the same samples**,
generated only once by `synthesize` (D1, D6). The `Player` copies them into an
`AudioBuffer` and plays them with an `AudioBufferSourceNode`. This guarantees [R7.2] by construction and makes
visual synchronization [R6.3] a simple comparison between `currentTime` and the
events' `start`.

### Module structure

```
src/
  core/
    types.ts        # shared types (section 3)
    normalize.ts    # NFD + diacritics removal [R1.4]
    tokenize.ts     # character classification [R1.5]
    rng.ts          # FNV-1a hash + mulberry32 PRNG [R3.8]
    timeline.ts     # slot/pause scheduling + voice application [R3.6–R3.8, R4.2–R4.3]
  styles/
    index.ts        # registry: StyleId → Style
    beep.ts
    grunt.ts
    alphabet.ts
  audio/
    synth.ts        # Timeline → Float32Array, pure DSP (D6)
    cache.ts        # memoizes the synthesis of the current timeline [R7.2]
    player.ts       # play/stop, latency-compensated position (D7)
    wav.ts          # AudioBuffer-like → WAV ArrayBuffer [R7.1]
  ui/
    controls.ts     # textarea, styles, sliders, buttons
    visualizer.ts   # letter grid + dots + highlight
    filename.ts     # export file name [R7.3]
  main.ts           # composition and state
  style.css
tests/              # mirror of src/core, src/styles, src/audio (except player)
```

## 3. Data model

```ts
type StyleId = 'beep' | 'grunt' | 'alphabet';

type TokenKind = 'letter' | 'digit' | 'space' | 'pause-short' | 'pause-long' | 'other';

interface Token {
  index: number;      // position in the original text (for the UI)
  char: string;       // original character, shown in the UI
  base: string;       // normalized lowercase character, used by the styles
  kind: TokenKind;
}

interface Voice {
  pitch: number;      // semitones, −12..12
  speed: number;      // characters/second, 5..30
  variation: number;  // 0..1
}

// What to play: abstract description, independent of Web Audio.
interface SoundSpec {
  waveform: 'square' | 'sawtooth' | 'triangle' | 'sine';
  frequency: number;          // Hz, before pitch/variation
  glide?: number;             // semitones of glissando over the whole duration
  durationRatio: number;      // fraction of the slot, (0, 0.9]
  formants?: [number, number];// Hz, parallel band-pass (grunt timbre)
  vocalTract?: Resonance[];   // cascaded resonators (vowels) [R3.9]
  noiseBurst?: { centerHz: number; durationMs: number }; // consonant attack
  gain: number;               // 0..1
}

interface Resonance { frequency: number; bandwidth: number } // Hz

interface Dot { color: string; size: 'sm' | 'md' | 'lg' }

interface SoundEvent {
  tokenIndex: number;
  start: number;      // seconds from the start
  duration: number;   // seconds
  sound: SoundSpec;   // with frequency already transposed and varied
  dot: Dot;
}

interface Timeline {
  tokens: Token[];
  events: SoundEvent[];
  duration: number;   // end of last event + 0.05 [R7.4]
}

interface Style {
  id: StyleId;
  label: string;
  description: string;
  reference: string;
  // Pure: same input → same output. `prev` serves the R3.3 constraint.
  voice(token: Token, rng: () => number, prev: SoundSpec | null): { sound: SoundSpec; dot: Dot };
}
```

## 4. Core algorithms

### 4.1 Normalization and tokenization [R1.4, R1.5]

1. `base = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()`.
2. Classification, in this order:
   - `\n` or `. ! ? …` → `pause-long`
   - `, ; :` → `pause-short`
   - spaces and tabs → `space`
   - `base` in `a–z` → `letter`
   - `0–9` → `digit`
   - everything else → `other` (emoji, non-Latin alphabets, symbols)
3. Iteration is per *grapheme* (`Intl.Segmenter`), so a composite emoji counts as a single token.

### 4.2 Determinism [R3.8]

- `seed = fnv1a(styleId + '\u0000' + text)`.
- `rng = mulberry32(seed)`: the only source of randomness, consumed in token order.
- Using `Math.random()` in the core is forbidden (verified by a test that replaces it with a function that throws an error).

### 4.3 Scheduling [R3.6, R3.7, R7.4]

```
slot = 1 / voice.speed
t = 0
for each token:
  space        → t += 1 slot
  pause-short  → t += 2 slot
  pause-long   → t += 4 slot
  sounding     → { sound, dot } = style.voice(token, rng, prev)
                 dur = sound.durationRatio * slot      // ≤ 0.9 slot ⇒ no overlap
                 semitones = voice.pitch + (rng() * 2 - 1) * voice.variation * 2
                 freq = sound.frequency * 2^(semitones / 12)
                 emit event(start = t, duration = dur)
                 t += 1 slot
duration = last event.start + last event.duration + 0.05
```

Note: `rng()` for the variation is **always** consumed, even with variation 0,
so the styles' random sequence does not depend on the variation.

## 5. Styles

Base frequencies before transposition [R4.2].

### 5.1 `beep` [R3.1]

| Property | Value |
|---|---|
| Waveform | `square` |
| Frequency | 520 Hz |
| `durationRatio` | 0.5 |
| Gain | 0.35 |
| Dot | color `--teal`, `md` |

No use of `rng` inside the style.

### 5.2 `grunt` [R3.2, R3.3]

Four fixed grunts: low-pass filtered `sawtooth` wave, downward glissando.

| # | Frequency | Glide | `durationRatio` | Formants | Dot |
|---|---|---|---|---|---|
| 0 | 140 Hz | −3 | 0.5 | 600 / 1000 | `--teal`, `sm` |
| 1 | 180 Hz | −5 | 0.75 | 700 / 1200 | `--blue`, `md` |
| 2 | 110 Hz | −2 | 0.9 | 500 / 900 | `--olive`, `lg` |
| 3 | 210 Hz | −6 | 0.6 | 800 / 1400 | `--orange`, `md` |

Choice: `i = floor(rng() * 4)`; if `i` matches the previous grunt,
`i = (i + 1 + floor(rng() * 3)) % 4`. This way the distribution stays uniform over the
three allowed grunts.

### 5.3 `alphabet` [R3.4, R3.5, R3.9, R3.10] (D9)

Each letter = optional consonant attack (filtered noise) + vowel
synthesized with a vocal tract of 3 cascaded formants.

Formants of the Italian vowels (medium-high voice, suited to a pitch of
240 Hz), as frequency / bandwidth pairs in Hz:

| Vowel | F1 | F2 | F3 |
|---|---|---|---|
| a | 850 / 90 | 1400 / 110 | 2800 / 170 |
| e | 450 / 80 | 2200 / 110 | 2900 / 170 |
| i | 310 / 70 | 2600 / 120 | 3300 / 200 |
| o | 500 / 80 | 900 / 100 | 2800 / 170 |
| u | 340 / 70 | 800 / 100 | 2700 / 170 |
| schwa | 550 / 90 | 1550 / 110 | 2650 / 170 |

Vowel of each letter:

- the vowels `a e i o u` use **their own vowel** [R3.9];
- consonants use the vowel of their English name, Animalese style (D4):

| Consonants | Vowel |
|---|---|
| b c d g p t v z | i |
| f l m n s x | e |
| h j k | e |
| r y | a |
| q w | u |

With `n = letter index (a = 0 … z = 25)`:

- `sawtooth` waveform, base frequency `240 × 2^(o / 12)` with
  `o = ((n × 7) mod 5 − 2) × 0.5` semitones, hence `o ∈ {−1, −0.5, 0, 0.5, 1}` [R3.10];
- `glide` −1.5 semitones: the pitch drops slightly within each syllable, as in speech;
- `noiseBurst` only for consonants: `centerHz = 1500 + n × 250`, `durationMs = 12`;
- `durationRatio = 0.85`, gain 0.4;
- dot: `hsl(round(n × 360 / 26), 55%, 55%)`, `md`.

The tuple (vowel, `o`, `centerHz`) is different for each letter; a test
verifies that the 26 `SoundSpec`s are all distinct [R3.4].

Digits and `other`: schwa, 240 Hz, same glide, no noise, grey dot
`--muted` [R3.5].

Verification of R3.9: for each vowel a long event is synthesized at 100 Hz (at
240 Hz the harmonics are too sparse and the result depends on where they fall) and the
energy (Goertzel, in dB) is measured in the ±100 Hz bands around F1, F2 and F3 of
each of the five vowels. Each band is normalized by subtracting the mean
of the five vowels, which removes the common spectral tilt (−6 dB/octave),
which would otherwise always favor the vowels with low formants. The vowel with
the highest score must be the correct one. The test uses only the formant
table, not the filter code.

## 6. Audio

### 6.1 Synthesis [R5.4, R5.5, R7.2] (D6)

`synthesize(timeline, sampleRate = 44100): Float32Array`, pure function.

- Buffer of `ceil(duration × sampleRate)` samples. Each event writes only
  to its own samples `[start, start + duration)`, so the cost is linear in the
  number of sounding samples.
- Oscillator: phase accumulator. `square` and `sawtooth` with PolyBLEP
  correction against aliasing; `sine` and `triangle` direct.
- `glide`: exponential instantaneous frequency from `f` to `f × 2^(glide/12)` over
  the event.
- `formants`: two parallel band-pass biquads (RBJ cookbook, peak gain
  0 dB, Q = 8), each × 3 makeup (D5). Filter state reset at
  every event.
- `vocalTract`: cascaded Klatt resonators (unity DC gain,
  `y = A·x + B·y₁ + C·y₂`), one per formant, followed by a fixed calibration
  gain that brings the level of the vowels close to that of the
  other styles. In cascade the relative amplitudes of the formants already come out correct,
  without tuning a gain per formant (D9).
- Envelope: linear attack 3 ms, sustain, linear release in the last 15 ms
  (or 30% of the duration if shorter), so there are no clicks.
- `noiseBurst`: white noise from `mulberry32(fnv1a('noise'))` (never
  `Math.random`) → band-pass at `centerHz`, Q = 2 → exponential decay
  down to −60 dB in `durationMs`.
- Master gain 0.8. At the end the peak is measured: if > 0.98, the whole
  buffer is scaled to bring it back to 0.98 [R5.5].

### 6.2 Player [R5.1–R5.4, R8.4]

- A single `AudioContext`, created or resumed with `unlock()` synchronously
  inside the click on *Play*, before any `await` (Safari loses the gesture
  after an `await`).
- `play(samples)`: stops any active source, copies the samples into an
  `AudioBuffer`, creates an `AudioBufferSourceNode`, stores
  `startTime = ctx.currentTime + 0.02`, starts.
- `position()`: `ctx.currentTime − startTime − latency`, where latency is
  `outputLatency` (or `baseLatency` where it is missing), used by the visualizer (D7).
- `ended` event → `idle` state.
- Cache (`cache.ts`): the samples of the current timeline remain valid as long as
  text, style and voice do not change; the export reuses them.

### 6.3 WAV [R7.1]

`encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer`

- Standard RIFF/WAVE header, `fmt ` PCM (format 1), 1 channel, 16 bit.
- Conversion: `clamp(x, −1, 1)`, then `x < 0 ? x × 0x8000 : x × 0x7FFF`, little-endian.
- Pure function, takes the output of `synthesize` directly.

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
`timeline` → invalidation of the audio cache → redraw of the visualizer.
Recomputing the timeline is synchronous and costs O(n) over 500 characters, so
no debounce. Synthesis happens only on *Play* or *Export*.

### 7.3 Visualizer [R6.1–R6.5]

- Each token is a `<span>`; consecutive non-space tokens are grouped into
  a `.word` so that wrapping happens between words (a word longer than the line
  still wraps inside itself). Sounding tokens contain a dot
  (`<i>`) with `--dot-color` and a size class.
- Highlight: a `requestAnimationFrame` loop active only during `playing`
  finds the event with `start ≤ position() < start + duration` (binary search) and
  sets `data-active` on the token. Spaces remain visible as gaps.
- With `prefers-reduced-motion: reduce` no `transform: scale`, only color.
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

## 8. Test strategy

| Level | What | Requirements |
|---|---|---|
| Unit (Vitest, node) | normalize, tokenize, rng, timeline, three styles, synthesize, cache, encodeWav, filename | R1.3–R1.5, R3.x, R4.2–R4.3, R5.5, R6.2, R7.1–R7.4, R8.5 |
| Performance (Vitest) | `synthesize` on 500 characters at speed 5, all styles, under 250 ms | R5.4 |
| Smoke (headless Chrome, not in the repo) | play, highlight, stop on change, export, 320 px layout | R5, R6, R7, M2, M6, M9 |
| Lightweight property-based | for 200 random texts: no overlap, determinism, no repeated grunt | R3.3, R3.7, R3.8 |
| Snapshot | timeline of `"Hello, world!"` for each style | regressions |
| Manual | checklist in `tasks.md` (audio, sync, browsers, a11y) | the rest |

Only the `Player` is not tested in Node. R7.2 is guaranteed by the architecture
(same samples) and verified with a test that checks that the export uses the
cached samples.

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
