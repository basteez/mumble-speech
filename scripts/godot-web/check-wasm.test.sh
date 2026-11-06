#!/usr/bin/env bash
# Tests of check-wasm.mjs (specs/tasks.md W1, L4.17): a module that passes, and one that breaks each
# check in turn, built by wasm-fixtures.mjs; the .gdextension check on the repository's file and on
# broken copies. No Emscripten, Rust or Godot needed.
# Usage: scripts/godot-web/check-wasm.test.sh   (no arguments; needs node; runs in CI)
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
check=$here/check-wasm.mjs
gdext=$root/bindings/godot/addons/mumble_speech/mumble_speech.gdextension
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0
passed=0

node "$here/wasm-fixtures.mjs" "$work/fx" || { echo "test setup: wasm-fixtures.mjs failed" >&2; exit 1; }

# expect_exit <label> <exit status> <message fragment> <command...>
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

fx=$work/fx
expect_exit "side module without threads passes" 0 "check-wasm: ok" node "$check" "$fx/good.wasm" --budget 1000
expect_exit "prints raw and gzip size" 0 "gzip" node "$check" "$fx/good.wasm" --budget 1000
expect_exit "no dylink.0 section fails" 1 'no "dylink.0" section' node "$check" "$fx/no-dylink.wasm" --budget 1000
expect_exit "shared memory fails" 1 "shared memory" node "$check" "$fx/shared-memory.wasm" --budget 1000
expect_exit "atomics instruction fails" 1 "atomics instruction" node "$check" "$fx/atomics.wasm" --budget 1000
expect_exit "missing entry symbol fails" 1 'entry symbol "gdext_rust_init" is not exported' node "$check" "$fx/no-entry.wasm" --budget 1000
expect_exit "over budget fails" 1 "exceeds the budget" node "$check" "$fx/big.wasm" --budget 1000
expect_exit "within budget passes (same file, larger budget)" 0 "check-wasm: ok" node "$check" "$fx/big.wasm" --budget 100000
expect_exit "not a WebAssembly file fails" 1 "bad magic" node "$check" "$fx/not-wasm.wasm" --budget 1000
expect_exit "truncated file fails" 1 "malformed" node "$check" "$fx/truncated.wasm" --budget 1000
expect_exit "missing file fails" 1 "cannot read" node "$check" "$fx/absent.wasm"
expect_exit "no arguments is a usage error" 2 "usage" node "$check"
expect_exit "unknown option is a usage error" 2 "usage" node "$check" "$fx/good.wasm" --nope

# The entry symbol is read from the .gdextension file.
sed 's/gdext_rust_init/other_entry/' "$gdext" > "$work/other-entry.gdextension"
expect_exit "entry symbol comes from the .gdextension" 1 'entry symbol "other_entry" is not exported' \
  node "$check" "$fx/good.wasm" --gdextension "$work/other-entry.gdextension" --budget 1000

# The .gdextension check.
expect_exit "the repository's .gdextension lists both web keys" 0 "check-wasm: ok" node "$check" --gdextension "$gdext"
grep -v '^web\.' "$gdext" > "$work/no-web.gdextension"
expect_exit ".gdextension without web keys fails" 1 "web.debug.wasm32 is missing" node "$check" --gdextension "$work/no-web.gdextension"
grep -v '^web\.release\.wasm32' "$gdext" > "$work/no-release.gdextension"
expect_exit ".gdextension without the release key fails" 1 "web.release.wasm32 is missing" node "$check" --gdextension "$work/no-release.gdextension"
sed 's#bin/mumble_godot.wasm#bin/other.wasm#' "$gdext" > "$work/wrong-path.gdextension"
expect_exit ".gdextension with a wrong path fails" 1 "expected" node "$check" --gdextension "$work/wrong-path.gdextension"
{ cat "$gdext"; echo 'web.release.threads.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.threads.wasm"'; } > "$work/threads.gdextension"
expect_exit ".gdextension with a threads key fails" 1 "no threaded web build" node "$check" --gdextension "$work/threads.gdextension"

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
