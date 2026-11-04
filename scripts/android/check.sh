#!/usr/bin/env sh
# Checks the Android libraries before they are packaged (specs/design.md §9.4.1, L4.14).
# Usage: scripts/android/check.sh <dir> <mumble.h>
#   <dir>/<abi>/libmumble_ffi.so for arm64-v8a, armeabi-v7a and x86_64, and nothing else.
# For each library: shared object for the ABI's machine; exported mumble_* functions equal the
# functions declared in the header; every LOAD segment aligned to at least 16 KB; DT_NEEDED only
# system libraries. Needs llvm-readelf: $LLVM_READELF, else from the NDK ($ANDROID_NDK_HOME or
# $ANDROID_NDK_ROOT), else on PATH. If $GITHUB_STEP_SUMMARY is set, a table is appended to it.
set -u

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <dir> <mumble.h>" >&2
  exit 2
fi
dir=$1
header=$2

readelf=${LLVM_READELF:-}
if [ -z "$readelf" ]; then
  ndk=${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}
  if [ -n "$ndk" ]; then
    for candidate in "$ndk"/toolchains/llvm/prebuilt/*/bin/llvm-readelf; do
      [ -x "$candidate" ] && readelf=$candidate && break
    done
  fi
fi
if [ -z "$readelf" ]; then
  readelf=$(command -v llvm-readelf || true)
fi
if [ -z "$readelf" ]; then
  # Versioned names from a distribution package, e.g. /usr/bin/llvm-readelf-18.
  for candidate in /usr/bin/llvm-readelf-* /usr/lib/llvm-*/bin/llvm-readelf; do
    [ -x "$candidate" ] && readelf=$candidate
  done
fi
if [ -z "$readelf" ]; then
  echo "check.sh: llvm-readelf not found; set LLVM_READELF, ANDROID_NDK_HOME or put it on PATH" >&2
  exit 2
fi
[ -f "$header" ] || { echo "check.sh: header $header not found" >&2; exit 2; }
[ -d "$dir" ] || { echo "check.sh: directory $dir not found" >&2; exit 2; }

abis="arm64-v8a armeabi-v7a x86_64"
min_align=$((0x4000))
allowed_needed="libc.so libm.so libdl.so liblog.so"

failures=0
fail() {
  echo "check.sh: FAIL: $*" >&2
  failures=$((failures + 1))
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Functions declared in the header: a declaration starts at column 0 with a type and has the
# name followed by "(" on its first line.
grep -E '^[A-Za-z_][^;]*[^A-Za-z0-9_]mumble_[a-z0-9_]+\(' "$header" \
  | sed -E 's/^.*[^A-Za-z0-9_](mumble_[a-z0-9_]+)\(.*$/\1/' | sort -u > "$tmp/declared"
if [ ! -s "$tmp/declared" ]; then
  fail "no function declarations found in $header"
fi

# Nothing but the three ABI folders (and, in the Unity package, their .meta files).
for entry in "$dir"/* "$dir"/.[!.]*; do
  [ -e "$entry" ] || continue
  name=$(basename "$entry")
  case " $abis " in
    *" $name "* | *" ${name%.meta} "*) ;;
    *) fail "unexpected entry '$name' in $dir (expected only: $abis)" ;;
  esac
done

summary="| ABI | Size (bytes) | Exported functions | Min LOAD alignment |
|---|---|---|---|
"

for abi in $abis; do
  lib=$dir/$abi/libmumble_ffi.so
  if [ ! -f "$lib" ]; then
    fail "$abi: $lib is missing"
    continue
  fi
  before=$failures

  case $abi in
    arm64-v8a) machine=AArch64 ;;
    armeabi-v7a) machine=ARM ;;
    x86_64) machine=X86-64 ;;
  esac

  # ELF header: type and machine.
  "$readelf" -h "$lib" > "$tmp/header.txt" 2>"$tmp/err.txt" || { fail "$abi: llvm-readelf cannot read $lib: $(cat "$tmp/err.txt")"; continue; }
  type=$(sed -n 's/^ *Type: *//p' "$tmp/header.txt" | head -n 1)
  got_machine=$(sed -n 's/^ *Machine: *//p' "$tmp/header.txt" | head -n 1)
  case $type in
    DYN*) ;;
    *) fail "$abi: ELF type is '$type', expected DYN (shared object)" ;;
  esac
  case $machine in
    AArch64) [ "$got_machine" = "AArch64" ] || ok=no ;;
    ARM) [ "$got_machine" = "ARM" ] || ok=no ;;
    X86-64) case $got_machine in *X86-64*) ;; *) ok=no ;; esac ;;
  esac
  if [ "${ok:-yes}" = no ]; then
    fail "$abi: machine is '$got_machine', expected $machine (wrong ABI folder?)"
  fi
  unset ok

  # Exports: defined, global, default-visibility functions named mumble_*.
  "$readelf" --dyn-syms -W "$lib" 2>/dev/null \
    | awk '$4 == "FUNC" && ($5 == "GLOBAL" || $5 == "WEAK") && $6 == "DEFAULT" && $7 != "UND" && $8 ~ /^mumble_/ { sub(/@.*/, "", $8); print $8 }' \
    | sort -u > "$tmp/exported"
  missing=$(comm -23 "$tmp/declared" "$tmp/exported" | tr '\n' ' ')
  extra=$(comm -13 "$tmp/declared" "$tmp/exported" | tr '\n' ' ')
  [ -z "$missing" ] || fail "$abi: declared in the header but not exported: $missing"
  [ -z "$extra" ] || fail "$abi: exported but not declared in the header: $extra"
  symbols=$(wc -l < "$tmp/exported" | tr -d ' ')

  # Every LOAD segment aligned to 16 KB.
  "$readelf" -l -W "$lib" 2>/dev/null | awk '$1 == "LOAD" { print $NF }' > "$tmp/aligns"
  if [ ! -s "$tmp/aligns" ]; then
    fail "$abi: no LOAD segments found"
    align_min=0
  else
    align_min=
    while read -r a; do
      v=$((a))
      if [ "$v" -lt "$min_align" ]; then
        fail "$abi: LOAD segment aligned to $a, expected at least 0x4000 (16 KB pages)"
      fi
      if [ -z "$align_min" ] || [ "$v" -lt "$align_min" ]; then align_min=$v; fi
    done < "$tmp/aligns"
  fi

  # Dependencies: system libraries only.
  "$readelf" -d -W "$lib" 2>/dev/null | grep '(NEEDED)' | sed -E 's/^.*\[(.*)\].*$/\1/' > "$tmp/needed"
  while read -r n; do
    [ -n "$n" ] || continue
    case " $allowed_needed " in
      *" $n "*) ;;
      *) fail "$abi: depends on $n; allowed: $allowed_needed" ;;
    esac
  done < "$tmp/needed"

  size=$(wc -c < "$lib" | tr -d ' ')
  status=ok
  [ "$failures" -eq "$before" ] || status=FAILED
  printf '%s: %s bytes, %s exported functions, min LOAD alignment 0x%x [%s]\n' "$abi" "$size" "$symbols" "$align_min" "$status"
  summary="$summary| $abi | $size | $symbols | \`$(printf '0x%x' "$align_min")\` |
"
done

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "## Android libraries"; echo; printf '%s' "$summary"; } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$failures" -ne 0 ]; then
  echo "check.sh: $failures problem(s) found" >&2
  exit 1
fi
echo "check.sh: all Android libraries pass"
