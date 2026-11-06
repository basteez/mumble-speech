#!/usr/bin/env bash
# Tests of scripts/godot-web/build.sh and bindings/godot/build.sh argument and toolchain handling
# (specs/tasks.md W1) with a fake emcc and stub rustup and cargo: nothing is built.
# Usage: scripts/godot-web/build.test.sh   (no arguments; runs in CI)
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
build=$here/build.sh
godot_build=$root/bindings/godot/build.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0
passed=0
# shellcheck source=versions.env
. "$here/versions.env"

mkdir -p "$work/bin"
# Stubs: rustup does nothing, cargo records its arguments and fails (the build never runs).
printf '#!/bin/sh\necho "rustup $*" >> "%s/calls.txt"\nexit 0\n' "$work" > "$work/bin/rustup"
printf '#!/bin/sh\necho "cargo $*" >> "%s/calls.txt"\nexit 1\n' "$work" > "$work/bin/cargo"
# Fake emccs reporting a version.
printf '#!/bin/sh\necho "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.70 (abcdef)"\n' > "$work/emcc-old"
printf '#!/bin/sh\necho "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) %s (abcdef)"\n' "$EMSDK_VERSION" > "$work/emcc-pinned"
chmod +x "$work/bin"/* "$work"/emcc-*

expect_exit() {
  local label=$1 code=$2 fragment=$3 got
  shift 3
  "$@" > "$work/out.txt" 2>&1
  got=$?
  if [ "$got" -ne "$code" ]; then
    echo "FAIL $label: exit $got, expected $code:"; tail -n 20 "$work/out.txt"; failed=$((failed + 1))
  elif [ -n "$fragment" ] && ! grep -qF -- "$fragment" "$work/out.txt"; then
    echo "FAIL $label: no message containing '$fragment':"; tail -n 20 "$work/out.txt"; failed=$((failed + 1))
  else
    echo "ok   $label"; passed=$((passed + 1))
  fi
}

export PATH=$work/bin:$PATH
expect_exit "build.sh without an output directory is a usage error" 2 "usage" "$build"
expect_exit "build.sh with two arguments is a usage error" 2 "usage" "$build" a b
EMCC=$work/no-such-emcc expect_exit "missing emcc names the expected version" 1 "Emscripten $EMSDK_VERSION" "$build" "$work/out"
EMCC=$work/emcc-old expect_exit "another emcc version is rejected, naming both" 1 "emcc reports: emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.70" "$build" "$work/out"

: > "$work/calls.txt"
EMCC=$work/emcc-pinned expect_exit "the pinned emcc reaches the cargo build (stub fails it)" 1 "" "$build" "$work/out"
if grep -q "cargo +$RUST_NIGHTLY build -Zbuild-std -p mumble-godot --release --target wasm32-unknown-emscripten" "$work/calls.txt" \
  && grep -q "rustup toolchain install $RUST_NIGHTLY .*--component rust-src --target wasm32-unknown-emscripten" "$work/calls.txt"; then
  echo "ok   the build uses the pinned nightly, build-std and the Emscripten target"; passed=$((passed + 1))
else
  echo "FAIL the build command is not the documented one:"; cat "$work/calls.txt"; failed=$((failed + 1))
fi

expect_exit "bindings/godot/build.sh rejects an unknown argument" 2 "usage" "$godot_build" bogus

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
