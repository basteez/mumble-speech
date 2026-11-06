#!/usr/bin/env bash
# Builds the Godot web library: mumble-godot as a non-threaded WebAssembly side module for
# wasm32-unknown-emscripten, with the pinned nightly Rust and Emscripten
# (specs/design.md §9.3.1, L4.15, L4.17, LD27, LD28).
# Usage: scripts/godot-web/build.sh <out dir>   writes <out dir>/mumble_godot.wasm
# Environment: EMCC overrides the emcc command (tests).
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: build.sh <out dir>" >&2
  exit 2
fi
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
# shellcheck source=versions.env
. "$here/versions.env"
emcc=${EMCC:-emcc}

if ! command -v "$emcc" >/dev/null 2>&1; then
  echo "error: emcc not found; install Emscripten $EMSDK_VERSION (emsdk install $EMSDK_VERSION && emsdk activate $EMSDK_VERSION) and source emsdk_env.sh" >&2
  exit 1
fi
# Read the whole output before taking the first line: piping into `head -n 1` closes the pipe early,
# and emcc (Python) then exits 120 on the failed flush, which pipefail turns into a silent failure.
if ! reported=$("$emcc" --version 2>&1); then
  echo "error: '$emcc --version' failed: $reported" >&2
  exit 1
fi
reported=${reported%%$'\n'*}
case " $reported " in
  *" $EMSDK_VERSION "*) ;;
  *)
    echo "error: Emscripten $EMSDK_VERSION is required (scripts/godot-web/versions.env), but emcc reports: $reported" >&2
    exit 1
    ;;
esac

rustup toolchain install "$RUST_NIGHTLY" --profile minimal --component rust-src --target wasm32-unknown-emscripten
(cd "$root" && cargo "+$RUST_NIGHTLY" build -Zbuild-std -p mumble-godot --release --target wasm32-unknown-emscripten)

mkdir -p "$1"
cp "$root/target/wasm32-unknown-emscripten/release/mumble_godot.wasm" "$1/"
ls -l "$1/mumble_godot.wasm"
