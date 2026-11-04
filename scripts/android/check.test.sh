#!/usr/bin/env bash
# Negative and edge-case tests of check.sh and check-metas.sh that need no NDK (specs/tasks.md N1, N2, N3).
# check.sh reads the ELF files through llvm-readelf; here a fake one prints fixtures written next to
# each fake library, so every case is an exact, deliberate input. Real libraries are covered by
# selftest.sh (run in the CI android job).
# Usage: scripts/android/check.test.sh          (no arguments; runs locally and in CI)
# Exit status: 0 when every case gives the expected result, 1 otherwise.
set -uo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
check=$root/scripts/android/check.sh
metas=$root/scripts/android/check-metas.sh
header=$root/bindings/c/include/mumble.h
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0
passed=0

# --- Fake llvm-readelf ----------------------------------------------------------------------
# Reads <lib>.fx-h, .fx-l, .fx-d or .fx-syms for the mode given by the flag; a missing fixture
# means the file cannot be read.
mkdir -p "$work/bin"
cat > "$work/bin/llvm-readelf" <<'EOF'
#!/bin/sh
for lib; do :; done
case $1 in
  -h) suffix=h ;;
  -l) suffix=l ;;
  -d) suffix=d ;;
  --dyn-syms) suffix=syms ;;
  *) echo "fake llvm-readelf: unsupported arguments: $*" >&2; exit 3 ;;
esac
[ -f "$lib.fx-$suffix" ] || { echo "fake llvm-readelf: $lib: no such file" >&2; exit 1; }
cat "$lib.fx-$suffix"
EOF
chmod +x "$work/bin/llvm-readelf"
export LLVM_READELF=$work/bin/llvm-readelf

# The functions the header declares: what a good library exports.
declared=$work/declared.txt
grep -oE 'mumble_[a-z0-9_]+\(' "$header" | tr -d '(' | sort -u > "$declared"
[ -s "$declared" ] || { echo "test setup: no declared functions in $header" >&2; exit 1; }

# sym <name> [FUNC|OBJECT] [GLOBAL|LOCAL|WEAK] [DEFAULT|HIDDEN] [section index or UND]
# One line in the format of llvm-readelf --dyn-syms -W.
sym() {
  printf '%s: %s %s %s %s %s %s %s\n' "1" "0000000000001000" "120" "${2:-FUNC}" "${3:-GLOBAL}" \
    "${4:-DEFAULT}" "${5:-13}" "$1"
}

# syms <file> [omit <name>] [extra line...]: the dynamic symbols of a good library.
syms() {
  local file=$1 omit=
  shift
  if [ "${1:-}" = omit ]; then omit=$2; shift 2; fi
  : > "$file"
  while read -r name; do
    [ "$name" = "$omit" ] || sym "$name" >> "$file"
  done < "$declared"
  for extra; do printf '%s\n' "$extra" >> "$file"; done
}

# make_lib <lib> <ELF type> <machine> <LOAD alignments> <NEEDED libraries> <symbols file>
make_lib() {
  local lib=$1 type=$2 machine=$3 aligns=$4 needed=$5 symfile=$6 a n
  mkdir -p "$(dirname "$lib")"
  echo "not a real library" > "$lib"
  printf 'ELF Header:\n  Type: %s\n  Machine: %s\n' "$type" "$machine" > "$lib.fx-h"
  {
    echo "Program Headers:"
    for a in $aligns; do echo "  LOAD           0x000000 0x0000000000000000 0x0000000000000000 0x000a10 0x000a10 R   $a"; done
    echo "  GNU_STACK      0x000000 0x0000000000000000 0x0000000000000000 0x000000 0x000000 RW  0x10"
  } > "$lib.fx-l"
  {
    echo "Dynamic section:"
    for n in $needed; do echo " 0x0000000000000001 (NEEDED)             Shared library: [$n]"; done
    echo " 0x000000000000000e (SONAME)             Library soname: [libmumble_ffi.so]"
  } > "$lib.fx-d"
  cp "$symfile" "$lib.fx-syms"
}

# good_tree <dir>: the three libraries, all passing. Cases below break one thing each.
good_tree() {
  local dir=$1
  rm -rf "$dir"
  syms "$work/syms-good.txt"
  make_lib "$dir/arm64-v8a/libmumble_ffi.so" "DYN (Shared object file)" "AArch64" "0x4000" "libc.so libm.so liblog.so" "$work/syms-good.txt"
  make_lib "$dir/armeabi-v7a/libmumble_ffi.so" "DYN (Shared object file)" "ARM" "0x4000 0x4000" "libc.so libdl.so" "$work/syms-good.txt"
  make_lib "$dir/x86_64/libmumble_ffi.so" "DYN (Shared object file)" "Advanced Micro Devices X86-64" "0x4000" "libc.so" "$work/syms-good.txt"
}

# expect_exit <label> <exit status> <message fragment> <command...>
expect_exit() {
  local label=$1 code=$2 fragment=$3 got
  shift 3
  "$@" > "$work/out.txt" 2>&1
  got=$?
  if [ "$got" -ne "$code" ]; then
    echo "FAIL $label: exit $got, expected $code:"; cat "$work/out.txt"; failed=$((failed + 1))
  elif [ -n "$fragment" ] && ! grep -qF -- "$fragment" "$work/out.txt"; then
    echo "FAIL $label: no message containing '$fragment':"; cat "$work/out.txt"; failed=$((failed + 1))
  else
    echo "ok   $label"; passed=$((passed + 1))
  fi
}
pass() { expect_exit "$1" 0 "$2" "${@:3}"; }
fail() { expect_exit "$1" 1 "$2" "${@:3}"; }

# --- check.sh: happy path and edge cases ------------------------------------------------------
good_tree "$work/good"
pass "intact libraries pass" "all Android libraries pass" "$check" "$work/good" "$header"

# Versioned and hidden symbols: a versioned export counts (name@@VERSION), a hidden or local one does not.
good_tree "$work/versioned"
syms "$work/syms-versioned.txt" omit mumble_abi_version
sym mumble_abi_version@@LIBMUMBLE >> "$work/syms-versioned.txt"
sym mumble_internal_helper FUNC GLOBAL HIDDEN >> "$work/syms-versioned.txt"
sym mumble_local_helper FUNC LOCAL >> "$work/syms-versioned.txt"
cp "$work/syms-versioned.txt" "$work/versioned/x86_64/libmumble_ffi.so.fx-syms"
pass "versioned symbol counts as exported, hidden and local symbols do not" "all Android libraries pass" \
  "$check" "$work/versioned" "$header"

good_tree "$work/undefined"
syms "$work/syms-undef.txt" omit mumble_render_free
sym mumble_render_free FUNC GLOBAL DEFAULT UND >> "$work/syms-undef.txt"
cp "$work/syms-undef.txt" "$work/undefined/arm64-v8a/libmumble_ffi.so.fx-syms"
fail "declared function only imported (UND), not exported" "declared in the header but not exported: mumble_render_free" \
  "$check" "$work/undefined" "$header"

# Missing export: the header declares one more function than the library exports (N1 negative).
sed 's/^uint32_t mumble_abi_version(void);/&\nvoid mumble_selftest_extra(void);/' "$header" > "$work/extra.h"
good_tree "$work/extra-declared"
fail "header declares a function the library does not export" "mumble_selftest_extra" \
  "$check" "$work/extra-declared" "$work/extra.h"

good_tree "$work/one-missing"
syms "$work/syms-omit.txt" omit mumble_speaker_free
cp "$work/syms-omit.txt" "$work/one-missing/x86_64/libmumble_ffi.so.fx-syms"
fail "one declared function missing from one ABI" "x86_64: declared in the header but not exported: mumble_speaker_free" \
  "$check" "$work/one-missing" "$header"

good_tree "$work/extra-exported"
syms "$work/syms-more.txt" "$(sym mumble_not_in_header)"
cp "$work/syms-more.txt" "$work/extra-exported/armeabi-v7a/libmumble_ffi.so.fx-syms"
fail "library exports a function the header does not declare" "exported but not declared in the header: mumble_not_in_header" \
  "$check" "$work/extra-exported" "$header"

# Wrong machine (library in the wrong ABI folder), and wrong ELF type (EXEC instead of a shared object).
good_tree "$work/wrong-machine"
printf 'ELF Header:\n  Type: DYN (Shared object file)\n  Machine: X86-64\n' > "$work/wrong-machine/arm64-v8a/libmumble_ffi.so.fx-h"
fail "library of another machine in the ABI folder" "arm64-v8a: machine is 'X86-64', expected AArch64" \
  "$check" "$work/wrong-machine" "$header"

good_tree "$work/exec"
printf 'ELF Header:\n  Type: EXEC (Executable file)\n  Machine: ARM\n' > "$work/exec/armeabi-v7a/libmumble_ffi.so.fx-h"
fail "executable instead of a shared object (EXEC)" "armeabi-v7a: ELF type is 'EXEC (Executable file)', expected DYN" \
  "$check" "$work/exec" "$header"

# Dependencies: a disallowed library, and one allowed library listed among others.
good_tree "$work/needed"
make_lib "$work/needed/x86_64/libmumble_ffi.so" "DYN (Shared object file)" "Advanced Micro Devices X86-64" "0x4000" "libc.so libssl.so" "$work/syms-good.txt"
fail "depends on a library that is not a system library" "x86_64: depends on libssl.so" \
  "$check" "$work/needed" "$header"

# Alignment: a 4 KB LOAD segment fails, even if another segment is 16 KB; no LOAD segments fails.
good_tree "$work/align-4k"
make_lib "$work/align-4k/arm64-v8a/libmumble_ffi.so" "DYN (Shared object file)" "AArch64" "0x4000 0x1000" "libc.so" "$work/syms-good.txt"
fail "one LOAD segment aligned to 4 KB" "arm64-v8a: LOAD segment aligned to 0x1000" "$check" "$work/align-4k" "$header"

good_tree "$work/no-load"
make_lib "$work/no-load/x86_64/libmumble_ffi.so" "DYN (Shared object file)" "Advanced Micro Devices X86-64" "" "libc.so" "$work/syms-good.txt"
fail "library without LOAD segments" "x86_64: no LOAD segments found" "$check" "$work/no-load" "$header"

# ABI folders: missing, empty, unexpected entries.
good_tree "$work/missing-abi"
rm -rf "$work/missing-abi/armeabi-v7a"
fail "missing ABI folder" "armeabi-v7a/libmumble_ffi.so is missing" "$check" "$work/missing-abi" "$header"

good_tree "$work/empty-abi"
rm -f "$work/empty-abi/armeabi-v7a/libmumble_ffi.so"*
fail "ABI folder present but empty" "armeabi-v7a/libmumble_ffi.so is missing" "$check" "$work/empty-abi" "$header"

good_tree "$work/extra-abi"
mkdir "$work/extra-abi/x86"
fail "unexpected ABI folder" "unexpected entry 'x86'" "$check" "$work/extra-abi" "$header"

good_tree "$work/extra-file"
echo "stray" > "$work/extra-file/README.txt"
fail "unexpected file next to the ABI folders" "unexpected entry 'README.txt'" "$check" "$work/extra-file" "$header"

# In the Unity package the ABI folders have .meta files next to them: allowed; any other .meta is not.
good_tree "$work/folder-metas"
touch "$work/folder-metas/arm64-v8a.meta" "$work/folder-metas/armeabi-v7a.meta" "$work/folder-metas/x86_64.meta"
pass "ABI folder .meta files are allowed" "all Android libraries pass" "$check" "$work/folder-metas" "$header"
touch "$work/folder-metas/x86.meta"
fail ".meta of an unexpected entry" "unexpected entry 'x86.meta'" "$check" "$work/folder-metas" "$header"

# A library the fake cannot read is reported, not skipped.
good_tree "$work/unreadable"
rm -f "$work/unreadable/x86_64/libmumble_ffi.so.fx-h"
fail "library that llvm-readelf cannot read" "x86_64: llvm-readelf cannot read" "$check" "$work/unreadable" "$header"

# Several problems are all reported, with the count at the end.
good_tree "$work/many"
make_lib "$work/many/arm64-v8a/libmumble_ffi.so" "EXEC (Executable file)" "X86-64" "0x1000" "libfoo.so" "$work/syms-good.txt"
expect_exit "several problems are all reported" 1 "problem(s) found" "$check" "$work/many" "$header"
grep -q "arm64-v8a: ELF type" "$work/out.txt" && grep -q "arm64-v8a: depends on libfoo.so" "$work/out.txt" \
  && grep -q "arm64-v8a: LOAD segment aligned to 0x1000" "$work/out.txt" \
  && { echo "ok   every problem of one library is listed"; passed=$((passed + 1)); } \
  || { echo "FAIL not every problem is listed:"; cat "$work/out.txt"; failed=$((failed + 1)); }

# Usage and inputs.
expect_exit "no arguments is a usage error" 2 "usage" "$check"
expect_exit "header missing" 2 "not found" "$check" "$work/good" "$work/nope.h"
expect_exit "directory missing" 2 "not found" "$check" "$work/nope" "$header"

# The step summary gets one row per library.
good_tree "$work/summary"
GITHUB_STEP_SUMMARY="$work/summary.md" "$check" "$work/summary" "$header" > /dev/null 2>&1
if grep -q '^| arm64-v8a | ' "$work/summary.md" && grep -q '^| x86_64 | ' "$work/summary.md" \
  && grep -q '^| armeabi-v7a | ' "$work/summary.md" && grep -q '## Android libraries' "$work/summary.md"; then
  echo "ok   step summary lists the three libraries"; passed=$((passed + 1))
else
  echo "FAIL step summary is missing rows:"; cat "$work/summary.md" 2>/dev/null; failed=$((failed + 1))
fi

# --- check-metas.sh ---------------------------------------------------------------------------
# pkg: a copy of the Unity package's Plugins folder to mutate.
pkg() { rm -rf "$work/pkg"; mkdir "$work/pkg"; cp -R "$root/bindings/unity/Plugins" "$work/pkg/Plugins"; }
android=Plugins/Android/libs
meta_arm64=$android/arm64-v8a/libmumble_ffi.so.meta
meta_armv7=$android/armeabi-v7a/libmumble_ffi.so.meta
meta_x86=$android/x86_64/libmumble_ffi.so.meta

pass "intact package metas pass" "Android import settings are correct" "$metas" "$root/bindings/unity"

pkg
pass "copy of the intact package passes" "Android import settings are correct" "$metas" "$work/pkg"

pkg; sed -i.bak 's/CPU: ARM64/CPU: ARMv7/' "$work/pkg/$meta_arm64"
fail "Android meta with the wrong CPU" "expected ARM64" "$metas" "$work/pkg"

pkg; sed -i.bak 's/CPU: ARM64/CPU: X86_64/' "$work/pkg/$meta_arm64"; sed -i.bak 's/CPU: ARMv7/CPU: ARM64/' "$work/pkg/$meta_armv7"
fail "CPUs of two folders swapped" "expected ARM64" "$metas" "$work/pkg"

pkg; sed -i.bak '/Android: Android/,/CPU:/ s/enabled: 1/enabled: 0/' "$work/pkg/$meta_x86"
fail "Android entry disabled" "Android is not enabled in" "$metas" "$work/pkg"

pkg; sed -i.bak '/Editor: Editor/,/CPU:/ s/enabled: 0/enabled: 1/' "$work/pkg/$meta_x86"
fail "Android meta enables the editor" "Editor: Editor" "$metas" "$work/pkg"

pkg; sed -i.bak '/Standalone: Win64/,/CPU:/ s/enabled: 0/enabled: 1/' "$work/pkg/$meta_armv7"
fail "Android meta enables a standalone platform" "Standalone: Win64" "$metas" "$work/pkg"

pkg; sed -i.bak '/: Any/,/CPU:/ s/enabled: 0/enabled: 1/' "$work/pkg/$meta_arm64"
fail "Android meta enables every platform" "': Any' is enabled" "$metas" "$work/pkg"

pkg; rm "$work/pkg/$android/x86_64.meta"
fail "folder meta of an ABI folder missing" "x86_64.meta is missing" "$metas" "$work/pkg"

pkg; rm "$work/pkg/Plugins/Android.meta"
fail "Plugins/Android.meta missing" "Android.meta is missing" "$metas" "$work/pkg"

pkg; rm "$work/pkg/$meta_armv7"
fail "ABI meta missing" "$meta_armv7 is missing" "$metas" "$work/pkg"

pkg; touch "$work/pkg/$android/x86_64/libmumble_ffi.so"; rm "$work/pkg/$meta_x86"
fail "Android library without a .meta" "has no .meta" "$metas" "$work/pkg"

pkg; sed -i.bak 's/^  userData: $/  - first:\n      Android: Android\n    second:\n      enabled: 1\n      settings:\n        CPU: ARM64\n  userData: /' "$work/pkg/Plugins/Linux/x86_64/libmumble_ffi.so.meta"
fail "desktop meta enables Android" "desktop plugin enables Android" "$metas" "$work/pkg"

# GUIDs: Unity identifies assets by GUID, so two Android libraries with one GUID would share import
# settings. N2 asks for distinct, fixed GUIDs.
pkg; guid_arm64=$(sed -n 's/^guid: //p' "$work/pkg/$meta_arm64")
sed -i.bak "s/^guid: .*/guid: $guid_arm64/" "$work/pkg/$meta_x86"
fail "two Android .meta files share a GUID" "duplicate GUID" "$metas" "$work/pkg"

pkg; sed -i.bak 's/^guid: .*/guid: not-a-guid/' "$work/pkg/Plugins/Linux/x86_64/libmumble_ffi.so.meta"
fail "a .meta without a valid GUID" "has no valid guid" "$metas" "$work/pkg"

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
