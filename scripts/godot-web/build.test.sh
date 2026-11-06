#!/usr/bin/env bash
# Tests of scripts/godot-web/build.sh and bindings/godot/build.sh (specs/tasks.md W1, W5; L4.15, L4.17, LD28):
# argument and toolchain handling with a fake emcc and stub rustup and cargo, and the build paths with a stub
# cargo that writes the library the build would produce (a copy of the tree, so the repository is not touched).
# The web path ends in check-wasm.mjs: a broken library fails the build (L4.17). Needs node.
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
node "$here/wasm-fixtures.mjs" "$work/fx" || { echo "test setup: wasm-fixtures.mjs failed" >&2; exit 1; }
echo "fake library" > "$work/fake.so"

# Stubs: rustup does nothing. cargo records its arguments, then CARGO_STUB decides the outcome: "fail" (the
# default: the build fails), "ok" (writes the library the build would produce, copied from FAKE_WASM for
# wasm32-unknown-emscripten or FAKE_SO for the desktop build, under $STUB_ROOT/target), or "nothing" (succeeds
# without writing anything). cargo runs in the caller's folder, so the target folder is taken from STUB_ROOT.
printf '#!/bin/sh\necho "rustup $*" >> "%s/calls.txt"\nexit 0\n' "$work" > "$work/bin/rustup"
cat > "$work/bin/cargo" <<'EOF'
#!/bin/sh
echo "cargo $*" >> "$WORK/calls.txt"
case "$*" in
  *wasm32-unknown-emscripten*) target=target/wasm32-unknown-emscripten/release/mumble_godot.wasm; src=$FAKE_WASM ;;
  *) target=target/release/libmumble_godot.so; src=$FAKE_SO ;;
esac
case ${CARGO_STUB:-fail} in
  fail) exit 1 ;;
  ok) mkdir -p "$STUB_ROOT/$(dirname "$target")" && cp "$src" "$STUB_ROOT/$target" ;;
  nothing) ;;
esac
EOF
# Fake emccs reporting a version.
printf '#!/bin/sh\necho "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.70 (abcdef)"\n' > "$work/emcc-old"
printf '#!/bin/sh\necho "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) %s (abcdef)"\n' "$EMSDK_VERSION" > "$work/emcc-pinned"
chmod +x "$work/bin"/* "$work"/emcc-*
export WORK=$work FAKE_WASM=$work/fx/good.wasm FAKE_SO=$work/fake.so

# make_tree <dir>: a copy of the build scripts, the gdextension and the budget. The scripts find their root from
# their own location, so a build in the copy writes into the copy.
make_tree() {
  rm -rf "$1" && mkdir -p "$1/bindings/godot/addons/mumble_speech" "$1/scripts/godot-web"
  cp "$root/bindings/godot/build.sh" "$1/bindings/godot/"
  cp "$root/bindings/godot/addons/mumble_speech/mumble_speech.gdextension" "$1/bindings/godot/addons/mumble_speech/"
  cp "$here/build.sh" "$here/check-wasm.mjs" "$here/versions.env" "$1/scripts/godot-web/"
  touch "$1/Cargo.toml"
}

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

# --- The web build path: the library is copied to the output folder when cargo builds it (W1, L4.17) ----------
tree=$work/tree-ok
make_tree "$tree"
export EMCC=$work/emcc-pinned STUB_ROOT=$tree
CARGO_STUB=ok expect_exit "a web build with a successful cargo copies the library and exits 0" 0 "mumble_godot.wasm" \
  "$tree/scripts/godot-web/build.sh" "$work/out-web"
if cmp -s "$work/out-web/mumble_godot.wasm" "$work/fx/good.wasm"; then
  echo "ok   the copied library is the one cargo built"; passed=$((passed + 1))
else
  echo "FAIL the copied library differs from the one cargo built"; failed=$((failed + 1))
fi

# A cargo failure copies nothing, even when an older library is in the target folder (set -e stops the build).
tree=$work/tree-fail
make_tree "$tree"
mkdir -p "$tree/target/wasm32-unknown-emscripten/release"
echo "stale" > "$tree/target/wasm32-unknown-emscripten/release/mumble_godot.wasm"
export STUB_ROOT=$tree
CARGO_STUB=fail expect_exit "a failing cargo fails the web build" 1 "" "$tree/scripts/godot-web/build.sh" "$work/out-cargo-fail"
if [ ! -e "$work/out-cargo-fail/mumble_godot.wasm" ]; then
  echo "ok   a failing cargo leaves no library in the output folder, even a stale one"; passed=$((passed + 1))
else
  echo "FAIL a failing cargo copied a library"; failed=$((failed + 1))
fi

# cargo succeeds but writes no library: the copy fails, and the build fails with it.
tree=$work/tree-nothing
make_tree "$tree"
export STUB_ROOT=$tree
CARGO_STUB=nothing expect_exit "a cargo that writes no library fails the web build" 1 "" "$tree/scripts/godot-web/build.sh" "$work/out-nothing"
if [ ! -e "$work/out-nothing/mumble_godot.wasm" ]; then
  echo "ok   no library is reported when cargo wrote none"; passed=$((passed + 1))
else
  echo "FAIL a library appeared from nothing"; failed=$((failed + 1))
fi

# --- bindings/godot/build.sh web: the build, then the checks of L4.17 on the copied library ----------------------
tree=$work/tree-bindings
make_tree "$tree"
export STUB_ROOT=$tree
CARGO_STUB=ok expect_exit "bindings web build: a good library passes the checks and is in the addon" 0 "check-wasm: ok" \
  "$tree/bindings/godot/build.sh" web
if [ -f "$tree/bindings/godot/addons/mumble_speech/bin/mumble_godot.wasm" ]; then
  echo "ok   the library is copied into the addon's bin folder"; passed=$((passed + 1))
else
  echo "FAIL the library is not in the addon"; failed=$((failed + 1))
fi

tree=$work/tree-threaded
make_tree "$tree"
export STUB_ROOT=$tree FAKE_WASM=$work/fx/shared-memory.wasm
CARGO_STUB=ok expect_exit "bindings web build: a threaded library fails the build (L4.17)" 1 "shared memory" \
  "$tree/bindings/godot/build.sh" web
export FAKE_WASM=$work/fx/good.wasm

tree=$work/tree-budget
make_tree "$tree"
sed 's/^WASM_BUDGET_BYTES=.*/WASM_BUDGET_BYTES=10/' "$tree/scripts/godot-web/versions.env" > "$tree/scripts/godot-web/versions.env.new"
mv "$tree/scripts/godot-web/versions.env.new" "$tree/scripts/godot-web/versions.env"
export STUB_ROOT=$tree
CARGO_STUB=ok expect_exit "bindings web build: a library over the budget fails the build (LD34)" 1 "exceeds the budget" \
  "$tree/bindings/godot/build.sh" web

tree=$work/tree-nogdext
make_tree "$tree"
grep -v '^web\.' "$tree/bindings/godot/addons/mumble_speech/mumble_speech.gdextension" > "$tree/gdext.tmp"
mv "$tree/gdext.tmp" "$tree/bindings/godot/addons/mumble_speech/mumble_speech.gdextension"
export STUB_ROOT=$tree
CARGO_STUB=ok expect_exit "bindings web build: a .gdextension without web entries fails the build (LD27)" 1 "web.debug.wasm32 is missing" \
  "$tree/bindings/godot/build.sh" web

# --- bindings/godot/build.sh (desktop): the library for this machine is copied into the addon ---------------
tree=$work/tree-desktop
make_tree "$tree"
export STUB_ROOT=$tree
CARGO_STUB=ok expect_exit "desktop build copies the library for this machine" 0 "copied libmumble_godot.so" \
  "$tree/bindings/godot/build.sh"
if cmp -s "$tree/bindings/godot/addons/mumble_speech/bin/libmumble_godot.so" "$work/fake.so"; then
  echo "ok   the desktop library is the one cargo built"; passed=$((passed + 1))
else
  echo "FAIL the desktop library is missing or different"; failed=$((failed + 1))
fi

tree=$work/tree-desktop-fail
make_tree "$tree"
export STUB_ROOT=$tree
CARGO_STUB=fail expect_exit "desktop build fails when cargo fails" 1 "" "$tree/bindings/godot/build.sh"
if [ ! -e "$tree/bindings/godot/addons/mumble_speech/bin/libmumble_godot.so" ]; then
  echo "ok   a failing desktop build copies nothing"; passed=$((passed + 1))
else
  echo "FAIL a failing desktop build copied a library"; failed=$((failed + 1))
fi

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
