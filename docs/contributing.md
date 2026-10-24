# Contributing

## Specs first

The project is spec-driven. The
[specifications](https://github.com/basteez/mumble-speech/tree/main/specs) are the source
of truth:

- `requirements.md`: numbered requirements (`R…` behavior, `L…` library);
- `design.md`: architecture, algorithms, bindings, CI and the decision log;
- `tasks.md`: the implementation plan;
- `playground/`: the same three documents for the playground.

A change of behavior is written in the specs first, then in the code. Requirement and
decision IDs are cited in tasks, tests, commits and pull requests.

## Repository layout

| Path | Content |
|---|---|
| `crates/mumble-core` | The Rust core (crate `mumble-speech`) |
| `crates/mumble-wasm`, `packages/web` | WebAssembly exports and the npm package |
| `crates/mumble-ffi`, `bindings/c` | C ABI, header, CMake tests |
| `crates/mumble-godot`, `bindings/godot` | Godot GDExtension and addon project |
| `bindings/unity` | Unity package |
| `crates/mumble-conformance`, `conformance/` | Conformance vectors |
| `apps/playground` | The web playground (private) |
| `docs` | This site |

## Local development

Requirements: Rust stable (with `wasm32-unknown-unknown`), Node.js 24+,
`wasm-bindgen-cli` 0.2.129, CMake for the C tests, Godot 4.3+ for the Godot tests.

```sh
cargo test                                          # core and vectors
npm install
npm run build -w @mumble-speech/web                 # WASM + TypeScript
npm run dev -w @mumble-speech/playground            # hear your change
npm test                                            # web package and playground
npm run dev:docs                                    # this site
```

## Pull requests

`main` is protected: every change goes through a pull request, and CI must be green
(core on three operating systems, web, playground, C ABI on three platforms, Godot 4.3
and 4.7.2, C# interop, site). Keep pull requests focused on one task and cite its ID.
