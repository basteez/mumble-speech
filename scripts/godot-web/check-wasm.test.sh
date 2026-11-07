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
grep -v '^web\.release\.threads' "$gdext" > "$work/no-threads-key.gdextension"
expect_exit ".gdextension without a threaded key fails" 1 "web.release.threads.wasm32 is missing" node "$check" --gdextension "$work/no-threads-key.gdextension"
{ cat "$gdext"; echo 'web.release.nothreads.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.wasm"'; } > "$work/extra-key.gdextension"
expect_exit ".gdextension with an extra web key fails" 1 "not one of the four web keys" node "$check" --gdextension "$work/extra-key.gdextension"

# The threaded library (L4.20, LD38): a threaded side module passes only with --threads, and the file name must agree.
expect_exit "threaded side module passes with --threads" 0 "check-wasm: ok" node "$check" "$fx/good.threads.wasm" --threads --budget 1000
expect_exit "threaded run reports the atomics count" 0 "1 atomics instructions" node "$check" "$fx/good.threads.wasm" --threads --budget 1000
expect_exit "a threaded module without --threads fails (name and shared memory)" 1 "check it with --threads" node "$check" "$fx/good.threads.wasm" --budget 1000
expect_exit "a non-threaded module with --threads fails" 1 "not a threaded library name" node "$check" "$fx/good.wasm" --threads --budget 1000
expect_exit "shared memory without atomics fails with --threads" 1 "no atomics instruction" node "$check" "$fx/shared-no-atomics.threads.wasm" --threads --budget 1000
expect_exit "atomics without shared memory fails with --threads" 1 "no shared memory import" node "$check" "$fx/atomics-no-shared.threads.wasm" --threads --budget 1000
expect_exit "a defined memory fails with --threads" 1 "defines a memory" node "$check" "$fx/defined-memory.threads.wasm" --threads --budget 1000
expect_exit "threaded: missing entry symbol fails" 1 "is not exported" node "$check" "$fx/no-entry.threads.wasm" --threads --budget 1000
expect_exit "threaded: over budget fails" 1 "(LD38)" node "$check" "$fx/big.threads.wasm" --threads --budget 1000
expect_exit "threaded: the default budget is WASM_THREADS_BUDGET_BYTES" 0 "budget 656800 bytes" node "$check" "$fx/good.threads.wasm" --threads

# Threaded library, more cases (L4.20, LD38): the option twice, a swapped pair in the .gdextension, and a versions.env
# without the threaded budget, which must fail with --threads and pass when --budget is given.
expect_exit "--threads twice is a usage error" 2 "usage" node "$check" "$fx/good.threads.wasm" --threads --threads --budget 1000
expect_exit "a non-threaded module checked with --threads fails (no shared memory)" 1 "no shared memory import" \
  node "$check" "$fx/no-entry.wasm" --threads --budget 1000
sed 's#web.release.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.wasm"#web.release.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.threads.wasm"#' "$gdext" > "$work/swapped.gdextension"
expect_exit ".gdextension with a threaded path under the non-threaded key fails" 1 'web.release.wasm32 is "res://addons/mumble_speech/bin/mumble_godot.threads.wasm"' \
  node "$check" --gdextension "$work/swapped.gdextension"
mkdir -p "$work/nobudget"
cp "$check" "$work/nobudget/check-wasm.mjs"
printf 'WASM_BUDGET_BYTES=651012\n' > "$work/nobudget/versions.env"
expect_exit "a versions.env without WASM_THREADS_BUDGET_BYTES fails with --threads" 1 "WASM_THREADS_BUDGET_BYTES" \
  node "$work/nobudget/check-wasm.mjs" "$fx/good.threads.wasm" --threads
expect_exit "the same file passes with an explicit --budget" 0 "check-wasm: ok" \
  node "$work/nobudget/check-wasm.mjs" "$fx/good.threads.wasm" --threads --budget 1000

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
