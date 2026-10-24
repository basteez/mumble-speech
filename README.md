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

> **Status:** early development. The Rust core is done; bindings are in
> progress. Nothing is published yet.

## Repository layout

```
crates/mumble-core/   Rust core (crate `mumble-speech`)
apps/playground/      web playground to try the styles (private, not published)
specs/                requirements, design and plan (spec-driven: start here)
```

## Development

Requirements: Rust (stable) and Node.js 24+.

```bash
cargo test                    # core tests
cargo test --release          # also runs the performance check
npm install
npm run dev --workspace @mumble-speech/playground   # http://localhost:5173
npm test                      # playground tests
```

Changes start from the specs: see [`specs/README.md`](specs/README.md) for the process.

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
