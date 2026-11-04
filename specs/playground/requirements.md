# Requirements

> **Note (library):** the engine has been extracted into the library
> ([`../requirements.md`](../requirements.md)). R1.4, R1.5, R3.x, R4.2, R4.3,
> R5.5, R7.1 and R7.4 are specified there, with the same IDs; they remain here for
> reference as long as the playground still uses its TypeScript core (tasks P1–P3).
> With the library, R3.8 (explicit seed, LD1) and R8.6 (the WASM is
> excluded from the budget, covered by the library's L4.2) also change.

## 1. Goal

Allow anyone to write a sentence, choose a mumble speech style,
listen to it with a letter-by-letter visualization and download it
as a WAV file. Everything runs in the browser, with no backend.

## 2. Glossary

| Term | Meaning |
|---|---|
| **Style** | Algorithm that decides which sound to associate with each character. In v1: `beep`, `grunt`, `alphabet`. |
| **Sounding character** | Character that produces a sound: letter, digit or other symbol not classified as space or punctuation. |
| **Pause** | Silence produced by spaces, punctuation and line breaks. |
| **Slot** | Base time unit: `1 / speed` seconds. Each character occupies one or more slots. |
| **Timeline** | Ordered sequence of sound events computed from the text. It is identical for playback, visualization and export. |
| **Voice** | The set of adjustable parameters: pitch, speed, variation. |

## 3. Styles (reference)

| ID | UI name | Rule | Reference |
|---|---|---|---|
| `beep` | One beep per letter | The same beep for every sounding character. | Undertale |
| `grunt` | A few grunts per character | The voice has a small set of grunts; each sounding character plays one of them. | Banjo-Kazooie |
| `alphabet` | A sound for every letter | Each of the 26 letters has its own recognizable sound. | Animal Crossing |

## 4. Requirements

EARS format: *WHEN / WHILE / IF … the system SHALL …*. Criteria marked
**[auto]** must be covered by automated tests; those marked **[man]** by manual
verification (checklist in `tasks.md`).

### R1 — Text input

*As a user I want to write the sentence to be "spoken".*

- **R1.1** The system SHALL offer a multiline text field prefilled with `Hello`. [man]
- **R1.2** The system SHALL accept at most 500 characters and show an `n/500` counter. [man]
- **R1.3** IF the text contains no sounding characters, the system SHALL disable *Play* and *Export* and show the reason. [auto]
- **R1.4** The system SHALL treat accented letters as the base letter (`è` → `e`, `ñ` → `n`). [auto]
- **R1.5** The system SHALL classify each character into exactly one category: `letter`, `digit`, `space`, `pause-short` (`, ; :`), `pause-long` (`. ! ? …` and line break), `other`. [auto]

### R2 — Style selection

*As a user I want to choose among the three styles and understand what each one does.*

- **R2.1** The system SHALL show the three styles as mutually exclusive options, each with a name, a one-line description and a reference game. [man]
- **R2.2** The default style SHALL be `beep`. [man]
- **R2.3** WHEN the user changes style, the system SHALL recompute the visualization without reloading the page. [man]

### R3 — Style behavior

- **R3.1** (`beep`) Every sounding character SHALL produce the same sound; with variation = 0 all events SHALL have identical frequency. [auto]
- **R3.2** (`grunt`) The voice SHALL have exactly 4 grunts, distinct in pitch, duration and timbre. [auto]
- **R3.3** (`grunt`) Every sounding character SHALL play one of the 4 grunts, chosen pseudo-randomly but deterministically, and TWO consecutive sounding characters SHALL NOT use the same grunt. [auto]
- **R3.4** (`alphabet`) Each of the 26 letters SHALL have a sound different from all the others, and the same letter SHALL always produce the same sound (at variation = 0). [auto]
- **R3.5** (`alphabet`) Digits and `other` characters SHALL produce a single common neutral sound. [auto]
- **R3.6** (all) Spaces SHALL produce 1 slot of silence, `pause-short` 2 slots, `pause-long` 4 slots. [auto]
- **R3.7** (all) No sound SHALL exceed its own slot: events do not overlap. [auto]
- **R3.8** (all) Given the same text, style and voice, the timeline SHALL be identical across different runs (determinism). [auto]
- **R3.9** (`alphabet`) The letters `a e i o u` SHALL sound like the corresponding Italian vowels: the spectrum of each SHALL be closer to the formants of its own vowel than to those of the other four. [auto] [man]
- **R3.10** (`alphabet`) The base pitch SHALL vary by at most ±1 semitone between different letters: what distinguishes the letters is the timbre, not the note. [auto]

### R4 — Voice parameters

*As a user I want to adjust the voice to give the character personality.*

- **R4.1** The system SHALL offer three sliders with visible value:
  - **Pitch**: from −12 to +12 semitones, step 1, default 0. [man]
  - **Speed**: from 5 to 30 characters/second, step 1, default 15. [man]
  - **Variation**: from 0 to 1, step 0.05, default 0. [man]
- **R4.2** Pitch SHALL transpose all the style's frequencies by `2^(semitones/12)`. [auto]
- **R4.3** Variation SHALL add to each event a random (deterministic) pitch offset in the range `±variation × 2` semitones. [auto]
- **R4.4** Parameters SHALL be shared across styles: changing style does not reset them. [man]
- **R4.5** WHEN the user modifies a parameter during playback, the system SHALL stop playback. [man]

### R5 — Playback

- **R5.1** WHEN the user presses *Play*, the system SHALL play the timeline from the beginning. [man]
- **R5.2** WHILE playing, the button SHALL become *Stop* and stop the audio immediately if pressed. [man]
- **R5.3** WHEN the user presses *Play* during playback, or modifies text/style, the system SHALL stop the current playback before doing anything else. [man]
- **R5.4** The first sound SHALL start within 300 ms of the click with texts up to 500 characters, on a mid-range laptop. [man]
- **R5.5** The system SHALL NOT produce clipping: all samples SHALL stay within `[−1, 1]`. [auto]

### R6 — Visualization

*As a user I want to see which letter is "speaking", as in the reference image.*

- **R6.1** The system SHALL show the text as a row of characters in a pixel/monospace font, with a dot under each sounding character. Spaces and punctuation have NO dot. [man]
- **R6.2** Color and size of the dots SHALL depend on the style:
  - `beep`: all the same color and size;
  - `grunt`: color and size determined by the grunt played (4 combinations);
  - `alphabet`: color determined by the letter (26 distinct colors), constant size. [auto]
- **R6.3** WHILE the audio plays, the character and the dot of the current event SHALL be highlighted, with a perceived offset no greater than 50 ms relative to the sound. [man]
- **R6.4** The visualization SHALL wrap without horizontal scrolling from 320 px width upwards. [man]
- **R6.5** IF the user has `prefers-reduced-motion`, the highlight SHALL be a color change without scale animations. [man]

### R7 — WAV export

- **R7.1** WHEN the user presses *Export WAV*, the system SHALL download a 16-bit PCM, mono, 44,100 Hz WAV file. [auto]
- **R7.2** The exported audio SHALL be identical sample by sample to the audio played with the same inputs. [auto]
- **R7.3** The file name SHALL be `mumble-<style>-<YYYYMMDD-HHmmss>.wav`. [auto]
- **R7.4** The file duration SHALL be the end of the last sound plus 50 ms of tail; trailing pauses are excluded. [auto]

### R8 — Non-functional requirements

- **R8.1** The app SHALL be a static site, with no backend and no network calls after loading. [man]
- **R8.2** The app SHALL work in the last 2 versions of Chrome, Firefox, desktop Safari and iOS Safari. [man]
- **R8.3** All controls SHALL be keyboard-usable, with accessible labels and visible focus. [man]
- **R8.4** The `AudioContext` SHALL be created or resumed only in response to a user gesture (autoplay policy). [man]
- **R8.5** The logic going from text to timeline and the WAV encoder SHALL be pure functions, testable without a browser. [auto]
- **R8.6** The production bundle (JS + CSS, gzip, font excluded) SHALL stay under 50 KB. [man]
- **R8.7** Dark theme as in the reference, with text/background contrast of at least WCAG AA. [man]

### R9 — Shareable URL

*As a user I want the page address to describe the sound I set up, so that I can
send it to a friend and they hear exactly the same thing.* (Issue #20; design §7.6,
§7.7, D10–D16.)

"Settings" below means the inputs that determine the sound in the playground:
text, style, pitch, speed and variation. The seed is not a setting: the playground
always uses the library default (0) and has no seed control (D13).

- **R9.1** The query string of the page URL SHALL carry the settings, one parameter
  each, with the names and formats in design §7.6. [auto]
- **R9.2** WHEN the user changes the text, the style or a voice parameter, the system
  SHALL update the URL to the canonical form of the new settings (R9.10) within
  500 ms of the last change, replacing the current history entry: editing SHALL NOT
  add history entries, so *Back* leaves the page (D11). [auto] [man]
- **R9.3** The URL update SHALL change only the query string: the path (the site
  serves the page under `/playground/`), the fragment and any query parameter the
  playground does not own SHALL be preserved. [auto]
- **R9.4** WHEN the page loads with at least one settings parameter in the URL, the
  system SHALL initialize every control from the URL (applying R9.5–R9.8 to each
  value) and SHALL replace the URL with its canonical form without adding a history
  entry. WHEN the page loads with no settings parameter, the system SHALL use the
  defaults (R1.1, R2.2, R4.1) and SHALL leave the URL unchanged. [auto]
- **R9.5** IF a numeric parameter (`pitch`, `speed`, `variation`) is missing or is
  not a plain decimal number (for example empty, `abc`, `NaN`, `Infinity`, `0x10`,
  `1e3`, ` 3`), the system SHALL use that parameter's default (R4.1). IF it is a
  plain decimal number outside the R4.1 range, the system SHALL clamp it to the
  range; IF it is not a multiple of the R4.1 step, the system SHALL round it to the
  nearest step, ties rounding up (D14). [auto]
- **R9.6** IF `style` is missing or is not exactly one of `beep`, `grunt`, `alphabet`
  (case-sensitive), the system SHALL use the default style `beep` (R2.2). [auto]
- **R9.7** IF `text` is missing, the system SHALL use the default text `Hello`
  (R1.1). IF it is present, including empty, the system SHALL use its decoded value
  with line breaks normalized to `\n` (as the textarea does), truncated to the R1.2
  limit of 500 UTF-16 code units; truncation SHALL NOT split a surrogate pair (an
  unpaired high surrogate left at the end is dropped). [auto]
- **R9.8** IF a settings parameter appears more than once, the system SHALL use its
  first occurrence. IF the URL contains parameters the playground does not own, the
  system SHALL ignore them (and keep them, R9.3). [auto]
- **R9.9** The text SHALL be encoded as UTF-8 with percent-encoding
  (`application/x-www-form-urlencoded`, space as `+`). Parsing SHALL accept both `+`
  and `%20` as a space, and SHALL NOT fail on malformed input: percent-escaped bytes
  that are not valid UTF-8 decode to U+FFFD, and a `%` not followed by two hex
  digits stays a literal `%` (WHATWG `application/x-www-form-urlencoded` parsing). For every valid settings value `s` (any Unicode text up
  to 500 code units, including emoji, combining marks, line breaks, `&`, `=`, `+`,
  `%`, `#`), parsing the canonical serialization of `s` SHALL return `s`. [auto]
- **R9.10** The canonical form SHALL contain all five settings parameters, defaults
  included, exactly once each, in the order `text`, `style`, `pitch`, `speed`,
  `variation`, followed by the parameters the playground does not own in their
  original order. Numbers SHALL be written in shortest decimal form after the R9.5
  rounding (`-3`, `15`, `0`, `0.05`, `1`) (D12). [auto]
- **R9.11** IF the browser rejects a URL update (for example because of its rate
  limit on the History API), the system SHALL keep working without showing an
  error, and the next change SHALL try again. [auto]
- **R9.12** Updating the URL SHALL NOT reload the page, start or stop playback by
  itself, or make a network request (R8.1). Loading a URL with settings SHALL NOT
  start playback (R8.4). [man]

*As a user I want to copy the link in one click, so that I do not have to find and
select the address bar (on mobile it is often hidden).* (Maintainer review of
PR #27; design §7.7, D15–D16.)

- **R9.13** The page SHALL show a *Copy link* button in the action row, after *Play*
  and *Export WAV* (design §7.1). The button SHALL stay enabled in every state,
  including when R1.3 disables *Play* and *Export WAV* and during playback, because
  every settings state has a link. [man]
- **R9.14** WHEN the user presses *Copy link*, the system SHALL copy to the clipboard
  the absolute link of the current settings: the page's origin and path, the
  canonical query string of the current control values (R9.10, including the
  parameters the playground does not own, R9.3) and the current fragment, so the
  copied link is the address the bar shows once it is up to date (D15). The link
  SHALL be computed from the controls, not read from the address bar, so it is
  current even while a URL update is still pending (R9.2). [auto]
- **R9.15** WHEN the user presses *Copy link*, the system SHALL also write the URL of
  the current settings immediately (cancelling any pending debounced update),
  replacing the current history entry, so the address bar matches the copied link.
  This applies also when the page was loaded without settings parameters (R9.4
  covers only the load). IF that write fails (R9.11), the copy SHALL still happen.
  [auto]
- **R9.16** WHEN the copy succeeds, the button label SHALL change to *Link copied*
  and the text "Link copied" SHALL be announced to screen readers through a polite
  live region dedicated to this button (the R1.3 message region is rewritten on
  every state update). 2 s after the last successful press the label SHALL return
  to *Copy link* and the live region SHALL be cleared. Pressing again while the
  feedback is shown SHALL copy again, announce again and restart the 2 s. WHEN a
  setting changes, the feedback SHALL return to the idle state at once. Only the
  outcome of the most recent press SHALL be shown. [auto] [man]
- **R9.17** IF the Clipboard API is unavailable (for example in an insecure context,
  where `navigator.clipboard` is undefined) or `writeText` throws or rejects (for
  example permission denied), THEN the system SHALL copy the same link with the
  legacy fallback: a temporary off-screen read-only textarea, selected, and
  `document.execCommand('copy')` (D16); on success the feedback is the R9.16 one.
  IF the fallback also fails, THEN the system SHALL show the link in a visible,
  read-only, labelled text field below the action row, with the whole link selected
  and the focus moved to it, and SHALL announce "Could not copy automatically. The
  link is selected below." in the R9.16 live region. The field SHALL be hidden at
  the next settings change or the next successful copy. [auto] [man]
- **R9.18** Pressing *Copy link* SHALL NOT throw, leave an unhandled promise
  rejection or log an error, whatever the clipboard outcome. [auto]
- **R9.19** The *Copy link* button SHALL be a native `<button>`, activatable with
  Enter and Space, with an accessible name equal to its visible label, the visible
  focus of R8.3 and the styling of *Export WAV* (R8.7). Changing the label SHALL NOT
  change the button's size or move the other buttons. WHEN the fallback restores
  the page after copying, the focus SHALL return to the button. [man]
- **R9.20** Pressing *Copy link* SHALL NOT start or stop playback, change any
  setting, redraw the visualizer or make a network request (R8.1). [auto] [man]

## 5. Out of scope (v1)

- Real text-to-speech or syllable recognition.
- Sounds based on audio samples or uploaded by the user.
- Multiple voices/characters per style, savable presets.
- Settings persistence across visits (for example in local storage); shareable
  links are in scope since R9.
- A share sheet (Web Share API) or buttons for specific social networks: the
  address bar and the *Copy link* button (R9.13) are the share affordances.
- A seed control, and the seed in the URL (D13).
- Automatic intonation (for example rising pitch on `?`).
- Playback while typing.
- Export in formats other than WAV.

## 6. Resolved questions

Closed with the proposed defaults, approved together with the specs on 2026-10-19.

| # | Question | Decision |
|---|---|---|
| Q1 | UI language? | English, consistent with the style names. |
| Q2 | Are 4 grunts the right number for `grunt`? | 4, consistent with the example (3–4 different dots). |
| Q3 | Should digits in `alphabet` be read as a name (`1` → "one")? | No, neutral sound (R3.5). |
| Q4 | Planned deploy (GitHub Pages, Netlify…)? | GitHub Pages; only affects Vite's `base`. |
