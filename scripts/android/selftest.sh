#!/usr/bin/env bash
# Negative self-tests of check.sh and check-metas.sh (specs/tasks.md N1, N2): each deliberately
# broken input must make the check fail, and the intact input must pass.
# Usage: scripts/android/selftest.sh <dir with the built <abi>/libmumble_ffi.so>
# Needs the NDK (ANDROID_NDK_HOME) and cargo-ndk for the alignment case.
set -euo pipefail

libs=$(cd "$1" && pwd)
root=$(cd "$(dirname "$0")/../.." && pwd)
header=$root/bindings/c/include/mumble.h
check=$root/scripts/android/check.sh
metas=$root/scripts/android/check-metas.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0

expect_pass() {
  if "$@" >"$work/out.txt" 2>&1; then echo "ok   passes: $label"; else echo "FAIL expected to pass: $label"; cat "$work/out.txt"; failed=1; fi
}
# expect_fail <label> <message fragment> <command...>
expect_fail() {
  local label=$1 fragment=$2
  shift 2
  if "$@" >"$work/out.txt" 2>&1; then
    echo "FAIL expected to fail: $label"; failed=1
  elif ! grep -q -- "$fragment" "$work/out.txt"; then
    echo "FAIL $label: failed without the message '$fragment':"; cat "$work/out.txt"; failed=1
  else
    echo "ok   fails: $label"
  fi
}

label="intact libraries"; expect_pass "$check" "$libs" "$header"
label="intact package metas"; expect_pass "$metas" "$root/bindings/unity"

# check.sh
sed 's/^uint32_t mumble_abi_version(void);/&\nvoid mumble_selftest_extra(void);/' "$header" > "$work/extra.h"
grep -q mumble_selftest_extra "$work/extra.h"
expect_fail "header declares a function the library does not export" "mumble_selftest_extra" "$check" "$libs" "$work/extra.h"

cp -R "$libs" "$work/swapped"
mv "$work/swapped/arm64-v8a/libmumble_ffi.so" "$work/swapped/arm64-v8a.so"
cp "$work/swapped/x86_64/libmumble_ffi.so" "$work/swapped/arm64-v8a/libmumble_ffi.so"
expect_fail "library in the wrong ABI folder" "expected AArch64" "$check" "$work/swapped" "$header"

cp -R "$libs" "$work/missing"
rm -rf "$work/missing/armeabi-v7a"
expect_fail "missing ABI folder" "armeabi-v7a" "$check" "$work/missing" "$header"

cp -R "$libs" "$work/extra-dir"
mkdir "$work/extra-dir/x86"
expect_fail "unexpected ABI folder" "unexpected entry 'x86'" "$check" "$work/extra-dir" "$header"

# Alignment: link with a 4 KB page size instead of 16 KB (RUSTFLAGS replaces .cargo/config.toml).
(cd "$root" && CARGO_TARGET_DIR="$work/target-4k" RUSTFLAGS="-C link-arg=-Wl,-z,max-page-size=4096" \
  "$root/scripts/android/build.sh" "$work/libs-4k" >/dev/null 2>&1)
expect_fail "library linked with 4 KB alignment" "16 KB" "$check" "$work/libs-4k" "$header"

# check-metas.sh, on copies of the package.
pkg() { rm -rf "$work/pkg"; mkdir "$work/pkg"; cp -R "$root/bindings/unity/Plugins" "$work/pkg/Plugins"; }
android=Plugins/Android/libs
pkg; sed -i.bak 's/CPU: ARM64/CPU: ARMv7/' "$work/pkg/$android/arm64-v8a/libmumble_ffi.so.meta"
expect_fail "Android meta with the wrong CPU" "expected ARM64" "$metas" "$work/pkg"

pkg; sed -i.bak '/Editor: Editor/,/CPU:/ s/enabled: 0/enabled: 1/' "$work/pkg/$android/x86_64/libmumble_ffi.so.meta"
expect_fail "Android meta enables the editor" "Editor: Editor" "$metas" "$work/pkg"

pkg; sed -i.bak '/Standalone: Win64/,/CPU:/ s/enabled: 0/enabled: 1/' "$work/pkg/$android/armeabi-v7a/libmumble_ffi.so.meta"
expect_fail "Android meta enables a standalone platform" "Standalone: Win64" "$metas" "$work/pkg"

pkg; sed -i.bak 's/^  userData: $/  - first:\n      Android: Android\n    second:\n      enabled: 1\n      settings:\n        CPU: ARM64\n  userData: /' "$work/pkg/Plugins/Linux/x86_64/libmumble_ffi.so.meta"
expect_fail "desktop meta enables Android" "desktop plugin enables Android" "$metas" "$work/pkg"

pkg; touch "$work/pkg/$android/x86_64/libmumble_ffi.so"; rm "$work/pkg/$android/x86_64/libmumble_ffi.so.meta"
expect_fail "Android library without a .meta" "libmumble_ffi.so.meta" "$metas" "$work/pkg"

exit "$failed"
