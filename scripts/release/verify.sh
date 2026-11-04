#!/usr/bin/env bash
# Checks the release archives on Linux before anything is published (specs/tasks.md H1).
# Usage: scripts/release/verify.sh <version> <archives dir> <godot binary>
set -euo pipefail

version=$1
archives=$(cd "$2" && pwd)
godot=$3
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "== C archive: the tests link against the packaged library and pass"
unzip -q "$archives/mumble-speech-c-$version.zip" -d "$work"
c=$work/mumble-speech-c-$version
cmake -S "$root/bindings/c" -B "$work/c-build" -DCMAKE_BUILD_TYPE=Release -DMUMBLE_LIB_DIR="$c/lib/linux-x64" >/dev/null
cmake --build "$work/c-build" >/dev/null
ctest --test-dir "$work/c-build" --output-on-failure
cmp "$c/include/mumble.h" "$root/bindings/c/include/mumble.h"
# Android libraries are in the Unity package only (LD24). grep reads the whole listing (no -q): with
# pipefail, an early exit would make unzip fail on SIGPIPE and hide the match.
if unzip -l "$archives/mumble-speech-c-$version.zip" | grep -i android >/dev/null; then echo "Android files in the C archive"; exit 1; fi

echo "== Godot addon: the packaged addon passes the headless tests"
# Same layout as the repository: the tests read ../../conformance/vectors.json.
project=$work/bindings/godot
mkdir -p "$work/bindings" "$work/conformance"
cp -R "$root/bindings/godot" "$project"
cp "$root/conformance/vectors.json" "$work/conformance/"
rm -rf "$project/addons" "$project/.godot"
unzip -q "$archives/mumble-speech-godot-$version.zip" -d "$project"
for lib in libmumble_godot.so mumble_godot.dll libmumble_godot.dylib; do
  test -f "$project/addons/mumble_speech/bin/$lib" || { echo "missing $lib"; exit 1; }
done
"$godot" --headless --path "$project" --import >/dev/null 2>&1 || true
"$godot" --headless --path "$project" -s res://tests/run_tests.gd
if unzip -l "$archives/mumble-speech-godot-$version.zip" | grep -i android >/dev/null; then echo "Android files in the Godot addon"; exit 1; fi

echo "== Unity package: desktop and Android plugins, a .meta for every file, Android libraries checked"
mkdir -p "$work/unity" && tar -xzf "$archives/com.mumble-speech.unity-$version.tgz" -C "$work/unity"
p=$work/unity/package
for lib in Plugins/macOS/libmumble_ffi.dylib Plugins/Windows/x86_64/mumble_ffi.dll Plugins/Linux/x86_64/libmumble_ffi.so; do
  test -f "$p/$lib" && test -f "$p/$lib.meta" || { echo "missing $lib or its .meta"; exit 1; }
done
for abi in arm64-v8a armeabi-v7a x86_64; do
  lib=Plugins/Android/libs/$abi/libmumble_ffi.so
  test -f "$p/$lib" && test -f "$p/$lib.meta" || { echo "missing $lib or its .meta"; exit 1; }
done
"$root/scripts/android/check.sh" "$p/Plugins/Android/libs" "$root/bindings/c/include/mumble.h"
"$root/scripts/android/check-metas.sh" "$p"
missing=$(cd "$p" && find . -mindepth 1 ! -name '*.meta' ! -path '*/Samples~*' ! -name 'Samples~' | while read -r f; do [ -f "$f.meta" ] || echo "$f"; done)
if [ -n "$missing" ]; then echo "files without .meta:"; echo "$missing"; exit 1; fi
grep -q "\"version\": \"$version\"" "$p/package.json"

echo "== npm tarball: installs in an empty project and renders a vector"
mkdir -p "$work/npm" && cd "$work/npm"
echo '{"name":"consumer","private":true,"type":"module"}' > package.json
npm install --no-audit --no-fund "$archives/mumble-speech-web-$version.tgz" >/dev/null
node -e "
import('@mumble-speech/web').then(async ({ init, render }) => {
  await init();
  const r = render('Hello', { style: 'beep' }, 48000);
  if (r.samples.length !== 16800) { console.error('unexpected sample count', r.samples.length); process.exit(1); }
  console.log('npm tarball ok:', r.samples.length, 'samples');
});"

echo "all release archives verified"
