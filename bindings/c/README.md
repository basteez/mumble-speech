# mumble-speech C ABI

Video-game "mumble speech" from C, C++, or any language with a C FFI (C#, Python,
Unreal, …). Same output, bit for bit, as the web, Godot and Unity bindings.

> Early development: no prebuilt release yet. Build the library with
> `cargo build -p mumble-ffi --release` (output in `target/release/`).

## Use

```c
#include "mumble.h"

MumbleVoice voice = {2 /* alphabet */, 2.0 /* pitch */, 15.0 /* speed */, 0.2 /* variation */, 42 /* seed */};
MumbleRender *render = NULL;
if (mumble_render("Hello!", 6, &voice, 48000, &render) == MUMBLE_OK) {
    size_t count;
    const float *samples = mumble_render_samples(render, &count);   /* mono, 48 kHz */
    /* play or save `samples`; events: mumble_render_event_count / mumble_render_event */
    mumble_render_free(render);
}
```

Typewriter dialogue, one character at a time:

```c
MumbleSpeaker *speaker = NULL;
mumble_speaker_new(&voice, 48000, &speaker);
MumbleUtterance u;
mumble_speaker_next(speaker, "H", 1, &u);   /* play u.samples (u.sample_count), wait u.advance seconds */
mumble_speaker_free(speaker);
```

- Every function returns `MUMBLE_OK` (0) or a negative `MUMBLE_ERR_*` code; no panic
  crosses the boundary. `*_free` functions accept `NULL`.
- Text is `(pointer, length)` UTF-8, not NUL-terminated.
- Events and utterances carry `style` and `variant` (which grunt 0–3, which letter 0–25,
  26 neutral): a neutral sound identifier for mouth shapes or effects.
- `mumble_abi_version()` returns `MUMBLE_ABI_VERSION` (currently 2); it changes on every
  incompatible change.
- Full reference: [`include/mumble.h`](include/mumble.h).

## Build the tests and the example

```sh
cargo build -p mumble-ffi --release
cmake -S bindings/c -B build/c && cmake --build build/c && ctest --test-dir build/c
build/c/hello out.wav
```

The tests run every conformance vector through the C ABI.
