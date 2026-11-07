#!/usr/bin/env bash
# Builds the Godot web library: mumble-godot as a WebAssembly side module for wasm32-unknown-emscripten,
# with the pinned nightly Rust and Emscripten (specs/design.md §9.3.1, §9.3.2, L4.15, L4.17, L4.19, L4.20,
# LD27, LD28, LD36).
# Usage: scripts/godot-web/build.sh [--threads] <out dir>
#          without --threads: writes <out dir>/mumble_godot.wasm (no threads)
#          with --threads:    writes <out dir>/mumble_godot.threads.wasm (-pthread, +atomics, own target folder)
# Environment: EMCC overrides the emcc command (tests); CARGO_VERBOSE=1 passes -v to cargo (T1 checks the flags).
set -euo pipefail

usage() {
  echo "usage: build.sh [--threads] <out dir>" >&2
  exit 2
}
threads=0
out=""
for arg in "$@"; do
  case "$arg" in
    --threads) [ "$threads" -eq 0 ] || usage; threads=1 ;;
    -*) usage ;;
    *) [ -z "$out" ] || usage; out=$arg ;;
  esac
done
[ -n "$out" ] || usage
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
# shellcheck source=versions.env
. "$here/versions.env"
emcc=${EMCC:-emcc}

if ! command -v "$emcc" >/dev/null 2>&1; then
  echo "error: emcc not found; install Emscripten $EMSDK_VERSION (emsdk install $EMSDK_VERSION && emsdk activate $EMSDK_VERSION) and source emsdk_env.sh" >&2
  exit 1
fi
# Read the whole output before picking the version line: piping into `head -n 1` closes the pipe early,
# and emcc (Python) then exits 120 on the failed flush, which pipefail turns into a silent failure.
# The first line can be a "shared:INFO: (Emscripten: Running sanity checks)" notice on a fresh install,
# so take the "emcc (Emscripten ...) X.Y.Z" line rather than the first one.
if ! output=$("$emcc" --version 2>&1); then
  echo "error: '$emcc --version' failed: $output" >&2
  exit 1
fi
reported=""
while IFS= read -r line; do
  case "$line" in
    emcc\ \(*) reported=$line; break ;;
  esac
done <<< "$output"
[ -n "$reported" ] || reported=${output%%$'\n'*}
case " $reported " in
  *" $EMSDK_VERSION "*) ;;
  *)
    echo "error: Emscripten $EMSDK_VERSION is required (scripts/godot-web/versions.env), but emcc reports: $reported" >&2
    exit 1
    ;;
esac

rustup toolchain install "$RUST_NIGHTLY" --profile minimal --component rust-src --target wasm32-unknown-emscripten

verbose=()
[ "${CARGO_VERBOSE:-0}" = 1 ] && verbose=(-v)
if [ "$threads" -eq 1 ]; then
  # The shared flags stay in .cargo/config.toml; Cargo joins array values of every configuration source, the
  # command line last (LD36). A RUSTFLAGS variable would replace them instead. The threaded build has its own
  # target folder, so the two builds keep their own rebuilt std (it is built with these flags, atomics included).
  threads_config='target.wasm32-unknown-emscripten.rustflags=["-C","link-args=-pthread","-C","target-feature=+atomics"]'
  target_dir=target/godot-web-threads
  built=$root/$target_dir/wasm32-unknown-emscripten/release/mumble_godot.wasm
  name=mumble_godot.threads.wasm
  (cd "$root" && cargo "+$RUST_NIGHTLY" --config "$threads_config" build ${verbose[@]+"${verbose[@]}"} -Zbuild-std=std,panic_abort -p mumble-godot --release --target wasm32-unknown-emscripten --target-dir "$target_dir")
else
  built=$root/target/wasm32-unknown-emscripten/release/mumble_godot.wasm
  name=mumble_godot.wasm
  (cd "$root" && cargo "+$RUST_NIGHTLY" build ${verbose[@]+"${verbose[@]}"} -Zbuild-std=std,panic_abort -p mumble-godot --release --target wasm32-unknown-emscripten)
fi

mkdir -p "$out"
cp "$built" "$out/$name"
ls -l "$out/$name"
