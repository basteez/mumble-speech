# Concepts

## Voice

| Parameter | Range | Default | Meaning |
|---|---|---|---|
| `style` | `beep`, `grunt`, `alphabet` | `beep` | See [Styles](./styles). |
| `pitch` | −12 … +12 | 0 | Semitones, applied to every sound. |
| `speed` | 5 … 30 | 15 | Characters per second. One **slot** is `1 / speed` seconds. |
| `variation` | 0 … 1 | 0 | Random pitch deviation, up to ±`variation × 2` semitones per sound. |
| `seed` | unsigned 32-bit | 0 | Changes the random choices (grunts, variation). |

Values out of range are rejected with an error (`PitchOutOfRange`, `SpeedOutOfRange`,
`VariationOutOfRange`); so is a sample rate outside 8,000–192,000 Hz.

## Timeline

Rendering a line gives the samples and a timeline. Each **event** is one sound:

- `start` and `duration`, in seconds from the start of the line;
- where the character is in your text: grapheme index, UTF-8 range and UTF-16 range
  (Godot exposes code point indices instead, which is how its `String` counts);
- the [sound identifier](#sound-identifier).

The audio lasts until the end of the last sound plus 50 ms. A sound never lasts longer
than its slot, so events never overlap.

## Typewriter and advance

A **speaker** produces one character at a time. For each character you get:

- its samples (empty for spaces and punctuation);
- the **advance**: seconds to wait before the next character (1, 2 or 4 slots);
- its sound identifier, if it made a sound.

Feed the characters of a line to the same speaker, in order, and reset it (or create a
new one) for the next line. Placing each sound at the sum of the previous advances gives
exactly the samples of the whole-line render.

## Sound identifier

Every sound carries `style` and `variant`: which grunt (0–3), which letter (0–25), the
neutral sound (26) or the beep (0). It is neutral data: map it to mouth shapes, particle
effects, camera shakes or, as the playground does, to colored dots. The library itself
draws nothing.

## Determinism

The same text, voice, seed and sample rate give the same samples, **bit for bit**, on
every platform and binding: Linux, Windows, macOS (Apple Silicon and Intel), WebAssembly,
through Rust, C, C#, GDScript and TypeScript. All math runs in a portable software
implementation, and shared [conformance vectors](/reference/conformance) check it in CI.

The random choices depend only on the style, the seed and the characters already
spoken, never on the text that follows. Identical lines therefore sound identical:
pass a different seed (a line id, for example) to vary them.

## Text

- Text is split into **graphemes**, so a composite emoji counts as one character.
- Accented letters fold to their base letter; other alphabets and symbols use the
  style's neutral sound (or a beep, or a grunt).
- Punctuation and spaces are pauses; see [Styles](./styles#pauses).
