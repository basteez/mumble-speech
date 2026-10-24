# Styles

Three styles, after three games. Each sounding character (letter, digit or other
symbol) plays one sound; spaces and punctuation are silences.

## Beep

*One beep for every letter*, like **Undertale**. The same short square-wave beep for
every character. With variation at 0 every beep has the same pitch.

- Sound identifier: variant `0`.

## Grunt

*A few grunts for each character*, like **Banjo-Kazooie**. The voice has four grunts,
different in pitch, length and timbre; each character plays one of them, chosen
pseudo-randomly but deterministically, and never the same grunt twice in a row.

- Sound identifier: variant `0`–`3`, the grunt that plays.

## Alphabet

*A sound for every letter of the alphabet*, like **Animal Crossing**. Each letter is a
short syllable: an optional consonant attack (filtered noise) followed by a vowel made
with three formants, at almost the same pitch for every letter (within ±1 semitone), so
letters differ by timbre, not by note.

- The letters `a e i o u` sound as the Italian vowels.
- Consonants use the vowel of their English name (`b` → "bi", `f` → "e", `q` → "u").
- Accented letters fold to their base letter (`è` → `e`, `ñ` → `n`).
- Digits and other symbols share one neutral sound.
- Sound identifier: variant `0`–`25` for `a`–`z`, `26` for the neutral sound.

## Pauses

| Character | Silence |
|---|---|
| space, tab | 1 slot |
| `,` `;` `:` | 2 slots |
| `.` `!` `?` `…`, new line | 4 slots |

A slot is `1 / speed` seconds; see [Concepts](./concepts#voice).

The exact tables (frequencies, formants, envelopes) are in the
[design document](https://github.com/basteez/mumble-speech/blob/main/specs/design.md#5-styles).
