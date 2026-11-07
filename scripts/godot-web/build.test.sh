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
# CARGO_STUB_THREADS, when set, is the outcome of the threaded build only (its --target-dir is godot-web-threads).
printf '#!/bin/sh\necho "rustup $*" >> "%s/calls.txt"\nexit 0\n' "$work" > "$work/bin/rustup"
cat > "$work/bin/cargo" <<'EOF'
#!/bin/sh
echo "cargo $*" >> "$WORK/calls.txt"
case "$*" in
  *--target-dir\ target/godot-web-threads*) target=target/godot-web-threads/wasm32-unknown-emscripten/release/mumble_godot.wasm; src=$FAKE_THREADS_WASM; mode=${CARGO_STUB_THREADS:-${CARGO_STUB:-fail}} ;;
  *wasm32-unknown-emscripten*) target=target/wasm32-unknown-emscripten/release/mumble_godot.wasm; src=$FAKE_WASM; mode=${CARGO_STUB:-fail} ;;
  *) target=target/release/libmumble_godot.so; src=$FAKE_SO; mode=${CARGO_STUB:-fail} ;;
esac
case $mode in
  fail) exit 1 ;;
  ok) mkdir -p "$STUB_ROOT/$(dirname "$target")" && cp "$src" "$STUB_ROOT/$target" ;;
  nothing) ;;
esac
EOF
# Fake emccs reporting a version.
printf '#!/bin/sh\necho "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.70 (abcdef)"\n' > "$work/emcc-old"
printf '#!/bin/sh\necho "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) %s (abcdef)"\n' "$EMSDK_VERSION" > "$work/emcc-pinned"
# A fresh install prints a sanity-check notice before the version line, and more lines after it (LD28).
printf '#!/bin/sh\necho "shared:INFO: (Emscripten: Running sanity checks)" >&2\necho "emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) %s (abcdef)"\necho "Copyright (C) 2014 the Emscripten authors"\nfor i in 1 2 3 4 5 6 7 8 9; do echo "line $i"; done\n' "$EMSDK_VERSION" > "$work/emcc-notice"
printf '#!/bin/sh\necho "boom" >&2\nexit 3\n' > "$work/emcc-broken"
chmod +x "$work/bin"/* "$work"/emcc-*
export WORK=$work FAKE_WASM=$work/fx/good.wasm FAKE_THREADS_WASM=$work/fx/good.threads.wasm FAKE_SO=$work/fake.so

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
EMCC=$work/emcc-notice expect_exit "a sanity notice before the version line is skipped (reaches the cargo build)" 1 "" "$build" "$work/out"
EMCC=$work/emcc-broken expect_exit "a failing emcc --version is reported, not silent" 1 "emcc-broken --version' failed: boom" "$build" "$work/out"
if grep -q "cargo +$RUST_NIGHTLY build -Zbuild-std=std,panic_abort -p mumble-godot --release --target wasm32-unknown-emscripten" "$work/calls.txt" \
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

if [ -f "$tree/bindings/godot/addons/mumble_speech/bin/mumble_godot.threads.wasm" ]; then
  echo "ok   the threaded library is copied into the addon's bin folder too"; passed=$((passed + 1))
else
  echo "FAIL the threaded library is not in the addon"; failed=$((failed + 1))
fi

tree=$work/tree-threaded
make_tree "$tree"
export STUB_ROOT=$tree FAKE_WASM=$work/fx/shared-memory.wasm
CARGO_STUB=ok expect_exit "bindings web build: a threaded library in the non-threaded slot fails the build (L4.17)" 1 "shared memory" \
  "$tree/bindings/godot/build.sh" web
export FAKE_WASM=$work/fx/good.wasm

tree=$work/tree-nothreads-in-threads
make_tree "$tree"
export STUB_ROOT=$tree FAKE_THREADS_WASM=$work/fx/good.wasm
CARGO_STUB=ok expect_exit "bindings web build: a non-threaded library in the threaded slot fails the build (L4.20)" 1 "no shared memory import" \
  "$tree/bindings/godot/build.sh" web
export FAKE_THREADS_WASM=$work/fx/good.threads.wasm

# --- scripts/godot-web/build.sh --threads (T1, LD36) -------------------------------------------------------------
expect_exit "build.sh rejects an unknown option" 2 "usage" "$build" --bogus "$work/out"
expect_exit "build.sh --threads without an output directory is a usage error" 2 "usage" "$build" --threads
tree=$work/tree-threads-only
make_tree "$tree"
export STUB_ROOT=$tree
: > "$work/calls.txt"
CARGO_STUB=ok expect_exit "a threaded build writes mumble_godot.threads.wasm" 0 "mumble_godot.threads.wasm" \
  "$tree/scripts/godot-web/build.sh" --threads "$work/out-threads"
if [ -f "$work/out-threads/mumble_godot.threads.wasm" ] && [ ! -e "$work/out-threads/mumble_godot.wasm" ] \
  && grep -qF -- "--config target.wasm32-unknown-emscripten.rustflags=[\"-C\",\"link-args=-pthread\",\"-C\",\"target-feature=+atomics\"]" "$work/calls.txt" \
  && grep -qF -- "--target-dir target/godot-web-threads" "$work/calls.txt"; then
  echo "ok   the threaded build passes the --config flags and its own target folder"; passed=$((passed + 1))
else
  echo "FAIL the threaded build command is not the documented one:"; cat "$work/calls.txt"; failed=$((failed + 1))
fi
CARGO_STUB=fail expect_exit "a failing cargo fails the threaded build" 1 "" "$tree/scripts/godot-web/build.sh" --threads "$work/out-threads-fail"
EMCC=$work/emcc-old expect_exit "the emcc version check applies to --threads" 1 "Emscripten $EMSDK_VERSION is required" "$build" --threads "$work/out"
export EMCC=$work/emcc-pinned

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

# --- --threads (T1, L4.19, L4.20, LD36): the arguments, the cargo command, the failures and the checks -----------
# Argument order: the option before or after the output folder.
tree=$work/tree-order
make_tree "$tree"
export STUB_ROOT=$tree
CARGO_STUB=ok expect_exit "--threads after the output folder is accepted" 0 "mumble_godot.threads.wasm" \
  "$tree/scripts/godot-web/build.sh" "$work/out-order" --threads
if [ -f "$work/out-order/mumble_godot.threads.wasm" ]; then
  echo "ok   the threaded library is written when the option follows the folder"; passed=$((passed + 1))
else
  echo "FAIL the option after the folder did not write the threaded library"; failed=$((failed + 1))
fi
# Options and folders are counted: a second option, a second folder or an unknown option is a usage error.
expect_exit "--threads twice is a usage error (exit 2)" 2 "usage" "$build" --threads --threads "$work/out"
expect_exit "--threads with two folders is a usage error (exit 2)" 2 "usage" "$build" --threads "$work/out" "$work/out2"
expect_exit "an unknown option next to --threads is a usage error (exit 2)" 2 "usage" "$build" --threads --bogus "$work/out"
expect_exit "a lone dash is an unknown option, not a folder (exit 2)" 2 "usage" "$build" --threads -

# The threaded build's cargo command: the --config flags, the target folder, the pinned nightly and build-std.
tree=$work/tree-cmd
make_tree "$tree"
export STUB_ROOT=$tree
: > "$work/calls.txt"
CARGO_STUB=ok expect_exit "the threaded build of the command check succeeds" 0 "" "$tree/scripts/godot-web/build.sh" --threads "$work/out-cmd"
threaded_call=$(grep '^cargo ' "$work/calls.txt" | grep -- '--target-dir target/godot-web-threads' || true)
plain_call=$(grep '^cargo ' "$work/calls.txt" | grep -v -- '--target-dir target/godot-web-threads' || true)
check_call() {
  local label=$1 pattern=$2
  if printf '%s\n' "$threaded_call" | grep -qF -- "$pattern"; then
    echo "ok   $label"; passed=$((passed + 1))
  else
    echo "FAIL $label: '$pattern' not in: $threaded_call"; failed=$((failed + 1))
  fi
}
check_call "the threaded cargo call adds -C link-args=-pthread to the rustflags" 'link-args=-pthread'
check_call "the threaded cargo call adds -C target-feature=+atomics to the rustflags" 'target-feature=+atomics'
check_call "the threaded cargo call keeps the pinned nightly" "+$RUST_NIGHTLY"
check_call "the threaded cargo call builds std with panic_abort" '-Zbuild-std=std,panic_abort'
check_call "the threaded cargo call targets wasm32-unknown-emscripten in release, for mumble-godot" \
  '-p mumble-godot --release --target wasm32-unknown-emscripten'
check_call "the threaded cargo call uses its own target folder" '--target-dir target/godot-web-threads'
check_call "the flags are passed with --config, so the shared list in .cargo/config.toml is joined, not replaced" \
  '--config target.wasm32-unknown-emscripten.rustflags=["-C","link-args=-pthread","-C","target-feature=+atomics"]'
if [ -n "$threaded_call" ] && [ -z "$plain_call" ]; then
  echo "ok   the threaded build made exactly one cargo call, into its own folder"; passed=$((passed + 1))
else
  echo "FAIL the threaded build cargo calls are not the expected ones:"; cat "$work/calls.txt"; failed=$((failed + 1))
fi
# The non-threaded build of the same tree carries none of the threaded flags or folder.
: > "$work/calls.txt"
CARGO_STUB=ok expect_exit "the non-threaded build of the same tree succeeds" 0 "" "$tree/scripts/godot-web/build.sh" "$work/out-plain-cmd"
if grep -q -- '--config\|godot-web-threads\|link-args=-pthread\|+atomics' "$work/calls.txt"; then
  echo "FAIL the non-threaded cargo call carries the threaded flags or folder:"; cat "$work/calls.txt"; failed=$((failed + 1))
else
  echo "ok   the non-threaded cargo call carries no threaded flags and no threaded folder"; passed=$((passed + 1))
fi

# A threaded library is copied from the threaded target folder, and no non-threaded library is written.
if cmp -s "$work/out-cmd/mumble_godot.threads.wasm" "$work/fx/good.threads.wasm" && [ ! -e "$work/out-cmd/mumble_godot.wasm" ]; then
  echo "ok   the threaded output is the threaded build's library, and no non-threaded library is written"; passed=$((passed + 1))
else
  echo "FAIL the threaded output is wrong"; failed=$((failed + 1))
fi

# A failing threaded cargo copies nothing, even when a stale threaded library is in its target folder.
tree=$work/tree-threads-fail
make_tree "$tree"
mkdir -p "$tree/target/godot-web-threads/wasm32-unknown-emscripten/release"
echo "stale threaded" > "$tree/target/godot-web-threads/wasm32-unknown-emscripten/release/mumble_godot.wasm"
export STUB_ROOT=$tree
CARGO_STUB=fail expect_exit "a failing threaded cargo fails the build" 1 "" "$tree/scripts/godot-web/build.sh" --threads "$work/out-threads-stale"
if [ ! -e "$work/out-threads-stale/mumble_godot.threads.wasm" ] && [ ! -e "$work/out-threads-stale/mumble_godot.wasm" ]; then
  echo "ok   a failing threaded cargo copies no library, not even a stale one"; passed=$((passed + 1))
else
  echo "FAIL a failing threaded cargo copied a library"; failed=$((failed + 1))
fi

# A threaded cargo that succeeds but writes no library fails, and writes nothing.
tree=$work/tree-threads-nothing
make_tree "$tree"
export STUB_ROOT=$tree
CARGO_STUB=nothing expect_exit "a threaded cargo that writes no library fails the build" 1 "" "$tree/scripts/godot-web/build.sh" --threads "$work/out-threads-nothing"
if [ ! -e "$work/out-threads-nothing/mumble_godot.threads.wasm" ]; then
  echo "ok   no threaded library appears from nothing"; passed=$((passed + 1))
else
  echo "FAIL a threaded library appeared from nothing"; failed=$((failed + 1))
fi

# The emcc checks apply to the threaded build as to the other: a sanity notice is skipped, a failing emcc stops it.
tree=$work/tree-threads-emcc
make_tree "$tree"
export STUB_ROOT=$tree
: > "$work/calls.txt"
CARGO_STUB=ok EMCC=$work/emcc-notice expect_exit "a sanity notice before the version line is skipped in threaded mode" 0 "" \
  "$tree/scripts/godot-web/build.sh" --threads "$work/out-emcc-notice"
if grep -q -- '--target-dir target/godot-web-threads' "$work/calls.txt"; then
  echo "ok   the threaded build reached cargo after the emcc notice"; passed=$((passed + 1))
else
  echo "FAIL the threaded build did not reach cargo"; failed=$((failed + 1))
fi
CARGO_STUB=ok EMCC=$work/emcc-broken expect_exit "a failing emcc --version stops the threaded build" 1 "emcc-broken --version' failed: boom" \
  "$tree/scripts/godot-web/build.sh" --threads "$work/out-emcc-broken"
if [ ! -e "$work/out-emcc-broken/mumble_godot.threads.wasm" ]; then
  echo "ok   no threaded library after a failing emcc"; passed=$((passed + 1))
else
  echo "FAIL a threaded library was copied after a failing emcc"; failed=$((failed + 1))
fi

# --- bindings/godot/build.sh web: a failure of either build stops the web build (LD39) ----------------------
tree=$work/tree-web-threads-fails
make_tree "$tree"
export STUB_ROOT=$tree
CARGO_STUB=ok CARGO_STUB_THREADS=fail expect_exit "bindings web: a failing threaded build fails the web build" 1 "" \
  "$tree/bindings/godot/build.sh" web
# The non-threaded build has already copied its library into the addon; the failure is the exit status, and no check runs.
if [ ! -e "$tree/bindings/godot/addons/mumble_speech/bin/mumble_godot.threads.wasm" ] && ! grep -q "check-wasm: ok" "$work/out.txt"; then
  echo "ok   a failing threaded build leaves no threaded library, and the checks do not run"; passed=$((passed + 1))
else
  echo "FAIL the threaded library exists or the checks ran after a failing threaded build"; failed=$((failed + 1))
fi

tree=$work/tree-web-plain-fails
make_tree "$tree"
export STUB_ROOT=$tree
: > "$work/calls.txt"
CARGO_STUB=fail expect_exit "bindings web: a failing non-threaded build fails the web build" 1 "" \
  "$tree/bindings/godot/build.sh" web
if ! grep -q -- 'godot-web-threads' "$work/calls.txt"; then
  echo "ok   a failing non-threaded build stops before the threaded build"; passed=$((passed + 1))
else
  echo "FAIL the threaded build ran after the non-threaded build failed"; cat "$work/calls.txt"; failed=$((failed + 1))
fi

tree=$work/tree-web-both-ok
make_tree "$tree"
export STUB_ROOT=$tree
CARGO_STUB=ok expect_exit "bindings web: both libraries pass the checks in their slots" 0 "check-wasm: ok" \
  "$tree/bindings/godot/build.sh" web
if cmp -s "$tree/bindings/godot/addons/mumble_speech/bin/mumble_godot.threads.wasm" "$work/fx/good.threads.wasm" \
  && cmp -s "$tree/bindings/godot/addons/mumble_speech/bin/mumble_godot.wasm" "$work/fx/good.wasm"; then
  echo "ok   each slot holds the library of its mode"; passed=$((passed + 1))
else
  echo "FAIL a slot holds the wrong library"; failed=$((failed + 1))
fi

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
