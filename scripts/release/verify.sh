#!/usr/bin/env bash
# Checks the release archives on Linux before anything is published (specs/tasks.md H1).
# Usage: scripts/release/verify.sh <version> <archives dir> <godot binary>
# Environment: MUMBLE_VERIFY_WEB_RUN=0 skips the export and browser run of the Godot web library
#   (verify.test.sh, which has no Godot editor or browser); the side-module checks still run.
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
# The web library is in the Godot addon only (LD33).
if unzip -l "$archives/mumble-speech-c-$version.zip" | grep -i '\.wasm' >/dev/null; then echo "WebAssembly files in the C archive"; exit 1; fi

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

echo "== Godot addon: the two web libraries (without and with threads) are side modules, listed in the .gdextension, and run in a browser"
wasm=$project/addons/mumble_speech/bin/mumble_godot.wasm
wasm_threads=$project/addons/mumble_speech/bin/mumble_godot.threads.wasm
test -f "$wasm" || { echo "missing mumble_godot.wasm in the Godot addon"; exit 1; }
test -f "$wasm_threads" || { echo "missing mumble_godot.threads.wasm in the Godot addon"; exit 1; }
node "$root/scripts/godot-web/check-wasm.mjs" "$wasm" --gdextension "$project/addons/mumble_speech/mumble_speech.gdextension"
node "$root/scripts/godot-web/check-wasm.mjs" "$wasm_threads" --threads
if [ "${MUMBLE_VERIFY_WEB_RUN:-1}" != 0 ]; then
  # The exported test runners from the packaged addon, on this Godot (4.3, the minimum), in Chromium (L4.15, L4.19,
  # L5.2): without threads and without COOP/COEP, then with threads and with them.
  GODOT_PROJECT=$project "$root/scripts/godot-web/export.sh" "$godot" "$work/web-export"
  node "$root/scripts/godot-web/run-tests.mjs" "$work/web-export" --browser chromium --audio running
  GODOT_PROJECT=$project "$root/scripts/godot-web/export.sh" "$godot" "$work/web-export-threads" "Web (threads tests)"
  node "$root/scripts/godot-web/run-tests.mjs" "$work/web-export-threads" --browser chromium --audio running --threads
fi

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
if tar -tzf "$archives/com.mumble-speech.unity-$version.tgz" | grep -i '\.wasm' >/dev/null; then echo "WebAssembly files in the Unity package"; exit 1; fi
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
