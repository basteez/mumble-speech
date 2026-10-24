# Conformance vectors

Every binding must produce the same samples as the core, bit for bit. Shared
**conformance vectors** check it in CI on every pull request.

## What a vector is

One input (text, voice, seed, sample rate) and its expected result: the number of
samples, a hash of the samples, the duration and every event (position in the text,
times, sound variant). Four vectors expect an error instead (pitch, speed, variation,
sample rate out of range).

There are 34: ten inputs for each style, covering accents, emoji, empty text,
punctuation only, Windows line endings, long text, sample rates from 8 to 192 kHz and
seeds up to the maximum, plus the four error cases.

## The hash

64-bit FNV-1a (offset `0xcbf29ce484222325`, prime `0x100000001b3`) over the
little-endian bytes of the 32-bit float samples, written as a hex string. It is easy to
write in any language: each suite computes it itself.

## Where they run

| Suite | Platforms | How |
|---|---|---|
| Rust core | Linux x64, Windows x64, macOS arm64 | `cargo test` (debug and release) |
| WebAssembly | Node | Vitest in `packages/web` |
| C ABI | Linux, Windows, macOS universal (and x86_64 under Rosetta) | CTest in `bindings/c` |
| Godot | Godot 4.3 and 4.7.2 on Linux | headless GDScript tests |
| C# (Unity interop) | .NET 8 on Linux, C# 9 | `bindings/unity/DotnetTests~`; the same checks run as Unity EditMode tests |

## Files

They are generated from the core by `cargo run -p mumble-conformance -- generate`:

- `conformance/vectors.json` (format 2);
- `bindings/c/tests/vectors.h` for C;
- `bindings/unity/Tests/EditMode/Vectors.cs` for C#.

`cargo run -p mumble-conformance -- check` (and `cargo test`) fails if the committed
files differ from what the core produces. They are regenerated only for an intentional
change of behavior, which is first written in the specs; the diff then shows exactly
which outputs changed.
