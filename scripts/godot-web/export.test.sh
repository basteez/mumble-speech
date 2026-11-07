#!/usr/bin/env bash
# Tests of scripts/godot-web/export.sh (specs/design.md §9.3.1, L4.15, LD31, LD32) with a stub godot and a stub
# curl on PATH and a prepared template package: the version string of each Godot build (stable, beta, rc, dev,
# garbage), the template cache (hit, partial, miss, failed download), the preset argument and the missing web
# library. Nothing is exported and nothing is downloaded. No Godot or network needed.
# Usage: scripts/godot-web/export.test.sh   (no arguments; needs zip and unzip; runs in CI)
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
export_sh=$here/export.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0
passed=0

mkdir -p "$work/bin" "$work/home" "$work/xdg" "$work/project"
# The project's presets are the repository's: the script reads variant/thread_support from them (LD39).
cp "$here/../../bindings/godot/export_presets.cfg" "$work/project/export_presets.cfg"

# Stub godot: `--version` prints $STUB_VERSION; the export writes index.html and, unless the file
# $work/no-wasm exists, the library files named in $STUB_LIBS (default mumble_godot.wasm) next to it.
# Every call is logged.
cat > "$work/bin/godot" <<'EOF'
#!/bin/sh
echo "$*" >> "$GODOT_LOG"
case "$1" in
  --version) printf '%s\n' "$STUB_VERSION"; exit 0 ;;
esac
case " $* " in
  *" --export-release "*)
    for last; do :; done
    dir=$(dirname "$last")
    echo "<html>" > "$last"
    if [ ! -f "$WORK/no-wasm" ]; then for lib in ${STUB_LIBS:-mumble_godot.wasm}; do echo "wasm" > "$dir/$lib"; done; fi
    ;;
esac
exit 0
EOF
# Stub curl: logs the URL and copies the prepared template package to the -o file (or fails when $WORK/curl-fail exists).
cat > "$work/bin/curl" <<'EOF'
#!/bin/sh
echo "$*" >> "$WORK/curl.log"
[ -f "$WORK/curl-fail" ] && exit 22
out=
while [ $# -gt 0 ]; do
  case $1 in
    -o) out=$2; shift 2 ;;
    *) shift ;;
  esac
done
cp "$WORK/fixture.tpz" "$out"
EOF
chmod +x "$work/bin/godot" "$work/bin/curl"

# The template package of a release: the four dlink templates, as the official package holds them.
mkdir -p "$work/pkg/templates"
for t in web_dlink_release web_dlink_debug web_dlink_nothreads_release web_dlink_nothreads_debug; do
  echo "$t template" > "$work/pkg/templates/$t.zip"
done
(cd "$work/pkg" && zip -qr "$work/fixture.tpz" templates)

# export_run <out dir> [preset]: runs export.sh with the stubs for STUB_VERSION (set by the caller); sets rc.
export_run() {
  rc=0
  WORK=$work GODOT_LOG=$work/godot.log STUB_VERSION=${STUB_VERSION-} STUB_LIBS=${STUB_LIBS:-mumble_godot.wasm} HOME=$work/home XDG_DATA_HOME=$work/xdg \
    PATH=$work/bin:$PATH GODOT_TEMPLATE_CACHE=${CACHE:-$work/cache} GODOT_PROJECT=${PROJECT:-$work/project} \
    "$export_sh" "$work/bin/godot" "$1" ${2+"$2"} > "$work/out.txt" 2>&1 || rc=$?
}

# no_export: the last run started no export (the stub logs --version too, so only --export-release counts).
no_export() { ! grep -q -- '--export-release' "$work/godot.log" 2>/dev/null; }

# check <label> <condition command...>: passes when the command succeeds.
check() {
  local label=$1
  shift
  if "$@"; then
    echo "ok   $label"; passed=$((passed + 1))
  else
    echo "FAIL $label:"; tail -n 20 "$work/out.txt"; failed=$((failed + 1))
  fi
}
# expect_rc <label> <status> <fragment>: the last export_run exited with <status> and printed <fragment>.
expect_rc() {
  local label=$1 code=$2 fragment=$3
  if [ "$rc" -ne "$code" ]; then
    echo "FAIL $label: exit $rc, expected $code:"; tail -n 20 "$work/out.txt"; failed=$((failed + 1))
  elif [ -n "$fragment" ] && ! grep -qF -- "$fragment" "$work/out.txt"; then
    echo "FAIL $label: no message containing '$fragment':"; tail -n 20 "$work/out.txt"; failed=$((failed + 1))
  else
    echo "ok   $label"; passed=$((passed + 1))
  fi
}
calls() { if [ -f "$work/curl.log" ]; then wc -l < "$work/curl.log" | tr -d ' '; else echo 0; fi; }

# --- Usage (exit 2) ------------------------------------------------------------------------------
"$export_sh" > "$work/out.txt" 2>&1; rc=$?; expect_rc "no arguments is a usage error" 2 "usage: export.sh"
"$export_sh" "$work/bin/godot" > "$work/out.txt" 2>&1; rc=$?; expect_rc "one argument is a usage error" 2 "usage: export.sh"
"$export_sh" a b c d > "$work/out.txt" 2>&1; rc=$?; expect_rc "four arguments is a usage error" 2 "usage: export.sh"

# --- Version strings: stable is exported, anything else is refused before any download -------------
STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-stable"
expect_rc "a stable build with a patch number is exported" 0 "exported 'Web (tests)'"
check "the version is read from the first line of --version" grep -qx "Godot 4.7.2.stable" "$work/out.txt"
check "the template folder is installed with version.txt" \
  test "$(find "$work/home" "$work/xdg" -path '*/export_templates/4.7.2.stable/version.txt' -exec cat {} + 2>/dev/null)" = "4.7.2.stable"

rm -f "$work/curl.log"
STUB_VERSION="4.3.stable.official.77dcf97d8" export_run "$work/out-43"
expect_rc "a stable 4.3 build is exported" 0 "Godot 4.3.stable"
check "the templates are downloaded from the stable release tag" \
  grep -q "godot-builds/releases/download/4.3-stable/Godot_v4.3-stable_export_templates.tpz" "$work/curl.log"
check "the template cache keeps all four templates under the tag" \
  test -f "$work/cache/4.3-stable/web_dlink_nothreads_release.zip" -a -f "$work/cache/4.3-stable/web_dlink_nothreads_debug.zip" \
    -a -f "$work/cache/4.3-stable/web_dlink_release.zip" -a -f "$work/cache/4.3-stable/web_dlink_debug.zip"

for v in "4.4.beta2.official.1a2b" "4.5.rc1.official.3c4d" "4.6.dev3.custom_build.5e6f" "4.3.beta.official"; do
  before=$(calls)
  STUB_VERSION="$v" export_run "$work/out-pre"
  expect_rc "'$v' is refused as not a stable release" 1 "is not a stable Godot release"
  check "'$v' downloads nothing" test "$(calls)" = "$before"
done

STUB_VERSION="hello, not godot" export_run "$work/out-garbage"
expect_rc "garbage version output is refused" 1 "'hello, not godot' is not a stable Godot release"
STUB_VERSION="" export_run "$work/out-empty"
expect_rc "empty version output is refused" 1 "is not a stable Godot release"

# --- Template cache ----------------------------------------------------------------------------
# A cache hit (both templates present) downloads nothing.
before=$(calls)
STUB_VERSION="4.3.stable.official.77dcf97d8" export_run "$work/out-hit"
expect_rc "a cache hit exports" 0 "exported 'Web (tests)'"
check "a cache hit downloads nothing" test "$(calls)" = "$before"

# A cache with only some of the templates is fetched again.
partial=$work/cache-partial
mkdir -p "$partial/4.3-stable"
echo "release template" > "$partial/4.3-stable/web_dlink_nothreads_release.zip"
before=$(calls)
CACHE=$partial STUB_VERSION="4.3.stable.official.77dcf97d8" export_run "$work/out-partial"
expect_rc "a partial cache exports after fetching" 0 "exported 'Web (tests)'"
check "a partial cache is fetched" test "$(calls)" -gt "$before"

# A cache from before the threaded templates (the two non-threaded ones only) is refilled (LD39).
old=$work/cache-nothreads-only
mkdir -p "$old/4.3-stable"
echo "release template" > "$old/4.3-stable/web_dlink_nothreads_release.zip"
echo "debug template" > "$old/4.3-stable/web_dlink_nothreads_debug.zip"
before=$(calls)
CACHE=$old STUB_VERSION="4.3.stable.official.77dcf97d8" export_run "$work/out-old-cache"
expect_rc "a cache with the non-threaded templates only exports after fetching" 0 "exported 'Web (tests)'"
check "a cache with the non-threaded templates only is fetched" test "$(calls)" -gt "$before"
check "the threaded templates are then in the cache" test -f "$old/4.3-stable/web_dlink_release.zip" -a -f "$old/4.3-stable/web_dlink_debug.zip"

# A failed download stops the export: no index.html, a non-zero exit.
touch "$work/curl-fail"
CACHE=$work/cache-fails STUB_VERSION="4.3.stable.official.77dcf97d8" export_run "$work/out-fail"
rm -f "$work/curl-fail"
check "a failed template download exits non-zero" test "$rc" -ne 0
check "a failed template download writes no index.html" test ! -f "$work/out-fail/index.html"

# --- Preset and export ---------------------------------------------------------------------------
STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-default"
check "the default preset is Web (tests)" grep -qF -- "--export-release Web (tests) " "$work/godot.log"
STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-example" "Web"
check "the preset argument is passed through" grep -qF -- "--export-release Web $work/out-example/index.html" "$work/godot.log"
check "the export has index.html and mumble_godot.wasm" test -f "$work/out-example/index.html" -a -f "$work/out-example/mumble_godot.wasm"

# The vectors are copied into the export project (a git-ignored copy, as tests/web/vectors.json).
check "the conformance vectors are copied into the test project" \
  cmp -s "$work/project/tests/web/vectors.json" "$(cd "$here/../.." && pwd)/conformance/vectors.json"

# A missing web library fails the export and names the cause.
touch "$work/no-wasm"
STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-missing"
rm -f "$work/no-wasm"
expect_rc "an export without mumble_godot.wasm fails" 1 "the export has no mumble_godot.wasm"

# --- Threaded presets (T3, LD35, LD39): exactly the library of the preset's kind -------------------------------
STUB_LIBS=mumble_godot.threads.wasm STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-threads" "Web (threads tests)"
expect_rc "a threaded preset with the threaded library exports" 0 "(mumble_godot.threads.wasm)"
check "the threaded export passes the preset name to godot" grep -qF -- "--export-release Web (threads tests) $work/out-threads/index.html" "$work/godot.log"
STUB_LIBS=mumble_godot.threads.wasm STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-threads-example" "Web (threads)"
expect_rc "the Web (threads) preset exports too" 0 "(mumble_godot.threads.wasm)"
STUB_LIBS=mumble_godot.wasm STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-threads-wrong" "Web (threads tests)"
expect_rc "a threaded preset that exported the non-threaded library fails" 1 "the export has no mumble_godot.threads.wasm"
STUB_LIBS="mumble_godot.threads.wasm mumble_godot.wasm" STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-threads-both" "Web (threads tests)"
expect_rc "a threaded preset with both libraries fails" 1 "also has mumble_godot.wasm"
STUB_LIBS=mumble_godot.threads.wasm STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-plain-wrong" "Web (tests)"
expect_rc "a non-threaded preset that exported the threaded library fails" 1 "the export has no mumble_godot.wasm"
STUB_LIBS="mumble_godot.wasm mumble_godot.threads.wasm" STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-plain-both" "Web (tests)"
expect_rc "a non-threaded preset with both libraries fails" 1 "also has mumble_godot.threads.wasm"
STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-unknown" "Web (nope)"
expect_rc "an unknown preset name fails before exporting" 1 "preset 'Web (nope)'"


# --- Threads (T3, LD35, LD39): the preset's thread support decides the library, for any preset file -------------
# Projects of their own: the repository's presets with CRLF line ends, without the thread_support key, with a
# malformed value, and a folder without an export_presets.cfg. The script reads only the presets file here.
mkdir -p "$work/project-crlf" "$work/project-nokey" "$work/project-badvalue" "$work/project-empty"
awk '{ printf "%s\r\n", $0 }' "$here/../../bindings/godot/export_presets.cfg" > "$work/project-crlf/export_presets.cfg"
sed '/^variant\/thread_support=/d' "$here/../../bindings/godot/export_presets.cfg" > "$work/project-nokey/export_presets.cfg"
sed '/^\[preset\.1\.options\]$/,/^\[preset\.2\]$/{s/^variant\/thread_support=.*/variant\/thread_support=maybe/;}' \
  "$here/../../bindings/godot/export_presets.cfg" > "$work/project-badvalue/export_presets.cfg"
# A project without presets: every export must refuse before it starts.
rm -f "$work/godot.log"

# The presets file may have CRLF line ends (a Windows checkout with autocrlf): the same preset kinds are found (LD39).
PROJECT=$work/project-crlf STUB_LIBS=mumble_godot.threads.wasm STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-crlf-threads" "Web (threads tests)"
expect_rc "a CRLF presets file: the threaded preset exports the threaded library" 0 "(mumble_godot.threads.wasm)"
PROJECT=$work/project-crlf STUB_LIBS=mumble_godot.wasm STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-crlf-plain" "Web (tests)"
expect_rc "a CRLF presets file: the non-threaded preset exports the non-threaded library" 0 "(mumble_godot.wasm)"
PROJECT=$work/project-crlf STUB_LIBS=mumble_godot.wasm STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-crlf-wrong" "Web (threads tests)"
expect_rc "a CRLF presets file: the threaded preset with only the non-threaded library fails" 1 "the export has no mumble_godot.threads.wasm"

# A preset whose thread_support key is missing is not guessed: the export fails before it starts (LD39).
rm -f "$work/godot.log"
PROJECT=$work/project-nokey STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-nokey" "Web (tests)"
expect_rc "a preset without variant/thread_support fails, naming the key" 1 "variant/thread_support value not found"
check "a preset without the key starts no export" no_export
[ ! -f "$work/out-nokey/index.html" ] && echo "ok   no index.html for a preset without the key" && passed=$((passed + 1)) || { echo "FAIL index.html exists"; failed=$((failed + 1)); }

# A value that is neither true nor false is refused as well.
rm -f "$work/godot.log"
PROJECT=$work/project-badvalue STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-badvalue" "Web (tests)"
expect_rc "a malformed variant/thread_support value fails" 1 "variant/thread_support value not found"
check "a malformed value starts no export" no_export

# A presets file that is missing: refused before the export, with its path.
rm -f "$work/godot.log"
PROJECT=$work/project-empty STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-nofile" "Web (tests)"
expect_rc "a project without export_presets.cfg fails" 1 "export_presets.cfg not found"
check "a missing presets file starts no export" no_export

# Preset names are matched exactly: a prefix of a name, or a name with the wrong spacing, is an unknown preset.
for name in "Web (threads" "Web (threads tests" "web (tests)" "Web  (tests)"; do
  rm -f "$work/godot.log"
  STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-name" "$name"
  expect_rc "the preset name '$name' is matched exactly (unknown: fails)" 1 "preset '$name'"
  check "the unknown preset '$name' starts no export" no_export
done
rm -f "$work/godot.log"
STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-empty-name" ""
check "an empty preset name starts no export" no_export
expect_rc "an empty preset name fails" 1 "preset ''"

# The combinations of preset kind and library present (the others are above): a threaded preset with no library at all.
touch "$work/no-wasm"
STUB_LIBS=mumble_godot.threads.wasm STUB_VERSION="4.7.2.stable.official.abcdef012" export_run "$work/out-threads-none" "Web (threads tests)"
rm -f "$work/no-wasm"
expect_rc "a threaded preset with no library at all fails" 1 "the export has no mumble_godot.threads.wasm"

# --- Template cache (T3, LD39): all four templates are kept under the tag, and only a missing pair is fetched --
full=$work/cache-full
mkdir -p "$full/4.3-stable"
for t in web_dlink_release web_dlink_debug web_dlink_nothreads_release web_dlink_nothreads_debug; do echo "$t" > "$full/4.3-stable/$t.zip"; done
before=$(calls)
CACHE=$full STUB_LIBS=mumble_godot.threads.wasm STUB_VERSION="4.3.stable.official.77dcf97d8" export_run "$work/out-full" "Web (threads tests)"
expect_rc "a cache with all four templates exports a threaded preset" 0 "exported 'Web (threads tests)'"
check "a cache with all four templates downloads nothing" test "$(calls)" = "$before"
check "the four templates are installed for the threaded export too" \
  test -n "$(find "$work/home" "$work/xdg" -path '*/export_templates/4.3.stable/web_dlink_release.zip' 2>/dev/null)"

# A cache with the threaded pair only (no non-threaded one) is refilled as well.
threaded_only=$work/cache-threaded-only
mkdir -p "$threaded_only/4.3-stable"
echo "release template" > "$threaded_only/4.3-stable/web_dlink_release.zip"
echo "debug template" > "$threaded_only/4.3-stable/web_dlink_debug.zip"
before=$(calls)
CACHE=$threaded_only STUB_VERSION="4.3.stable.official.77dcf97d8" export_run "$work/out-threaded-only"
expect_rc "a cache with the threaded templates only exports after fetching" 0 "exported 'Web (tests)'"
check "a cache with the threaded templates only is fetched" test "$(calls)" -gt "$before"
check "the non-threaded templates are then in the cache" test -f "$threaded_only/4.3-stable/web_dlink_nothreads_release.zip" -a -f "$threaded_only/4.3-stable/web_dlink_nothreads_debug.zip"
echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
