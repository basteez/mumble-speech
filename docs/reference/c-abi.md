# C ABI reference

Version `MUMBLE_ABI_VERSION` = **2** (`mumble_abi_version()` returns it at run time).
Version 2 replaced the per-event dot (color and size) with the sound identifier.

## Rules

- Every function that can fail returns `int32_t`: `MUMBLE_OK` (0) or a negative code.
  On error, output parameters are left untouched.
- No Rust panic crosses the boundary: it becomes `MUMBLE_ERR_PANIC`.
- Text is `(const char *utf8, size_t len)`, not NUL-terminated. `utf8` may be `NULL`
  when `len` is 0.
- Objects are opaque and owned by the caller; `*_free` functions accept `NULL`.

## Error codes

| Code | Name | Meaning |
|---|---|---|
| 0 | `MUMBLE_OK` | Success |
| −1 | `MUMBLE_ERR_NULL` | A required pointer is `NULL` |
| −2 | `MUMBLE_ERR_UTF8` | Text is not valid UTF-8 |
| −3 | `MUMBLE_ERR_VOICE` | Voice out of range or unknown style |
| −4 | `MUMBLE_ERR_SAMPLE_RATE` | Sample rate outside 8,000–192,000 Hz |
| −5 | `MUMBLE_ERR_INDEX` | Event index out of range |
| −99 | `MUMBLE_ERR_PANIC` | Internal error caught at the boundary |

## Types

| Type | Fields |
|---|---|
| `MumbleVoice` | `style` (0 beep, 1 grunt, 2 alphabet), `pitch`, `speed`, `variation`, `seed` |
| `MumbleEvent` | `grapheme_index`, `utf8_start`, `utf8_len`, `utf16_start`, `utf16_len`, `start`, `duration`, `style`, `variant` |
| `MumbleUtterance` | `samples` (valid until the next call on the speaker or its free), `sample_count`, `advance`, `style`, `variant`, `has_sound` |
| `MumbleRender`, `MumbleSpeaker` | opaque |

## Functions

| Function | Description |
|---|---|
| `mumble_abi_version()` | ABI version of the loaded library. |
| `mumble_render(utf8, len, voice, sample_rate, &render)` | Renders a line. |
| `mumble_render_samples(render, &len)` | Mono `float` samples, valid until `mumble_render_free`. |
| `mumble_render_duration(render)` | Seconds: end of the last sound plus 50 ms. |
| `mumble_render_event_count(render)`, `mumble_render_event(render, i, &event)` | Events. |
| `mumble_render_free(render)` | Frees a render. |
| `mumble_speaker_new(voice, sample_rate, &speaker)` | Typewriter speaker. |
| `mumble_speaker_next(speaker, utf8, len, &utterance)` | Sound of the next character(s). |
| `mumble_speaker_reset(speaker)`, `mumble_speaker_free(speaker)` | Reset, free. |
| `mumble_encode_wav(samples, len, sample_rate, &bytes, &bytes_len)` | 16-bit PCM mono WAV. |
| `mumble_bytes_free(bytes, bytes_len)` | Frees WAV bytes. |
