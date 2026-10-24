# C ABI

A shared library with a plain C interface, usable from C, C++, C#, Python (ctypes),
Unreal and anything else with a C FFI. It is what the Unity package uses.

## Build

```sh
cargo build -p mumble-ffi --release   # target/release/libmumble_ffi.{so,dylib} or mumble_ffi.dll
```

The header is [`bindings/c/include/mumble.h`](https://github.com/basteez/mumble-speech/blob/main/bindings/c/include/mumble.h).
On macOS the library's install name is `@rpath/libmumble_ffi.dylib`.

## Use

```c
#include "mumble.h"

MumbleVoice voice = {2 /* alphabet */, 2.0, 15.0, 0.2, 42};
MumbleRender *render = NULL;
if (mumble_render("Hello!", 6, &voice, 48000, &render) == MUMBLE_OK) {
    size_t count;
    const float *samples = mumble_render_samples(render, &count);
    for (size_t i = 0; i < mumble_render_event_count(render); i++) {
        MumbleEvent e;
        mumble_render_event(render, i, &e);   /* e.start, e.duration, e.utf8_start, e.variant… */
    }
    mumble_render_free(render);
}

MumbleSpeaker *speaker = NULL;
mumble_speaker_new(&voice, 48000, &speaker);
MumbleUtterance u;
mumble_speaker_next(speaker, "H", 1, &u);     /* u.samples, u.sample_count, u.advance, u.has_sound */
mumble_speaker_free(speaker);
```

Full list of functions and rules: [C ABI reference](/reference/c-abi).
