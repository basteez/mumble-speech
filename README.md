# mumble-speech

Video-game "mumble speech" synthesis: turn a line of text into the babble that
characters speak in games, in three styles.

| Style | Rule | Reference |
|---|---|---|
| `beep` | The same beep for every character | Undertale |
| `grunt` | A few grunts per voice, never the same twice in a row | Banjo-Kazooie |
| `alphabet` | A vowel-based sound for every letter | Animal Crossing |

One implementation in Rust, deterministic and bit-identical across platforms,
with bindings for the web (WebAssembly/npm), Godot, Unity and a C ABI.

> **Status:** early development (0.x: the API may still change).
> Documentation and playground: **https://mumble-speech.github.io/** ·
> [Releases](https://github.com/basteez/mumble-speech/releases) · [Changelog](CHANGELOG.md) ·
> [npm](https://www.npmjs.com/package/@mumble-speech/web) ·
> [crates.io](https://crates.io/crates/mumble-speech) · [docs.rs](https://docs.rs/mumble-speech)

## Repository layout

```
crates/mumble-core/   Rust core (crate `mumble-speech`)
crates/mumble-wasm/   WebAssembly exports
packages/web/         npm package @mumble-speech/web (WASM inlined, TypeScript API)
crates/mumble-ffi/    C ABI (cdylib + staticlib)
bindings/c/           mumble.h, CMake tests and example
crates/mumble-godot/  Godot 4 GDExtension
bindings/godot/       Godot addon, example scene and headless tests
bindings/unity/       Unity package (UPM): C# interop, components, EditMode tests
apps/playground/      web playground to try the styles (private, not published)
docs/                 documentation site (VitePress), published with the playground
specs/                requirements, design and plan (spec-driven: start here)
```

## Development

Requirements: Rust (stable) with the `wasm32-unknown-unknown` target, Node.js 24+ and
`wasm-bindgen-cli` 0.2.129 (`cargo install wasm-bindgen-cli --version 0.2.129`).

```bash
cargo test                    # core tests
cargo test --release          # also runs the performance check
npm install
npm run build --workspace @mumble-speech/web       # WASM + TypeScript
npm run dev --workspace @mumble-speech/playground   # http://localhost:5173
npm test                      # web package and playground tests
cargo build -p mumble-ffi --release                 # C ABI
cmake -S bindings/c -B build/c && cmake --build build/c && ctest --test-dir build/c
bindings/godot/build.sh && godot --headless --path bindings/godot -s res://tests/run_tests.gd
bindings/unity/build.sh        # native library into the Unity package's Plugins/
```

Changes start from the specs: see [`specs/README.md`](specs/README.md) for the process.

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
