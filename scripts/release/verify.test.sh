#!/usr/bin/env bash
# Negative tests of scripts/release/verify.sh (specs/tasks.md N5, L4.13, L4.14, LD24) without the NDK,
# cmake or Godot: assemble.sh builds the four archives from fake native artifacts, the external tools
# verify.sh runs (cmake, ctest, godot, npm) are stubs, and check.sh reads the Android libraries through
# a fake llvm-readelf that reports a passing library. Each case breaks one archive and expects
# verify.sh to fail with its message.
# Usage: scripts/release/verify.test.sh   (no arguments; needs zip, unzip, tar and node; runs in CI)
set -uo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
assemble=$root/scripts/release/assemble.sh
verify=$root/scripts/release/verify.sh
version=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$root/bindings/unity/package.json")
[ -n "$version" ] || { echo "test setup: no version in bindings/unity/package.json" >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0
passed=0

# --- Stubs on PATH ----------------------------------------------------------------------------
stubs=$work/stubs
mkdir -p "$stubs"
for tool in cmake ctest godot; do
  printf '#!/bin/sh\nexit 0\n' > "$stubs/$tool"
done
# npm install <tgz>: installs a stand-in @mumble-speech/web that renders 16800 samples.
cat > "$stubs/npm" <<'EOF'
#!/bin/sh
[ "$1" = install ] || exit 0
mkdir -p node_modules/@mumble-speech/web
echo '{"name":"@mumble-speech/web","type":"module","main":"index.js"}' > node_modules/@mumble-speech/web/package.json
cat > node_modules/@mumble-speech/web/index.js <<'JS'
export async function init() {}
export function render() { return { samples: new Float32Array(16800) }; }
JS
EOF
# assemble.sh uses md5sum (Linux); macOS has md5.
if ! command -v md5sum >/dev/null 2>&1; then
  printf '#!/bin/sh\nmd5 -r | awk '"'"'{ print $1 "  -" }'"'"'\n' > "$stubs/md5sum"
fi
chmod +x "$stubs"/*
export PATH=$stubs:$PATH
export MUMBLE_VERIFY_WEB_RUN=0

# Fake llvm-readelf: every library passes, exporting the functions the header declares.
grep -oE 'mumble_[a-z0-9_]+\(' "$root/bindings/c/include/mumble.h" | tr -d '(' | sort -u > "$work/exports.txt"
cat > "$work/llvm-readelf" <<'EOF'
#!/bin/sh
for lib; do :; done
case $1 in
  -h)
    case $lib in
      *arm64-v8a*) machine=AArch64 ;;
      *armeabi-v7a*) machine=ARM ;;
      *) machine="Advanced Micro Devices X86-64" ;;
    esac
    printf 'ELF Header:\n  Type: DYN (Shared object file)\n  Machine: %s\n' "$machine" ;;
  -l) echo "  LOAD 0x000000 0x0 0x0 0xa10 0xa10 R 0x4000" ;;
  -d) echo " 0x0000000000000001 (NEEDED) Shared library: [libc.so]" ;;
  --dyn-syms) while read -r n; do echo "1: 0000000000001000 120 FUNC GLOBAL DEFAULT 13 $n"; done < "$FAKE_EXPORTS" ;;
esac
EOF
chmod +x "$work/llvm-readelf"
export LLVM_READELF=$work/llvm-readelf FAKE_EXPORTS=$work/exports.txt

# --- Artifacts and the release archives -------------------------------------------------------
# Fake native artifacts, as the release workflow downloads them.
art=$work/artifacts
mkdir -p "$art/native-linux-x64" "$art/native-windows-x64" "$art/native-macos-universal" \
  "$art/native-android/arm64-v8a" "$art/native-android/armeabi-v7a" "$art/native-android/x86_64" "$art/native-web" "$art/web"
for f in native-linux-x64/libmumble_ffi.so native-linux-x64/libmumble_godot.so \
  native-windows-x64/mumble_ffi.dll native-windows-x64/mumble_ffi.dll.lib native-windows-x64/mumble_godot.dll \
  native-macos-universal/libmumble_ffi.dylib native-macos-universal/libmumble_godot.dylib \
  native-android/arm64-v8a/libmumble_ffi.so native-android/armeabi-v7a/libmumble_ffi.so native-android/x86_64/libmumble_ffi.so; do
  echo "fake $f" > "$art/$f"
done
# The Godot web library: a tiny side module that passes scripts/godot-web/check-wasm.mjs.
node "$root/scripts/godot-web/wasm-fixtures.mjs" "$work/wasm-fixtures" || { echo "test setup: wasm-fixtures.mjs failed" >&2; exit 1; }
cp "$work/wasm-fixtures/good.wasm" "$art/native-web/mumble_godot.wasm"
mkdir -p "$work/npm-src/package" && echo '{"name":"@mumble-speech/web"}' > "$work/npm-src/package/package.json"
tar -czf "$art/web/mumble-speech-web-$version.tgz" -C "$work/npm-src" package

# build_archives <output dir>: the four archives, as assemble.sh makes them.
build_archives() {
  rm -rf "$1" && mkdir -p "$1"
  "$assemble" "$version" "$art" "$1" >/dev/null 2>&1 || { echo "test setup: assemble.sh failed" >&2; exit 1; }
}

# Each case works on its own copy of the archives.
good=$work/good
build_archives "$good"
copy_archives() { rm -rf "$work/case" && mkdir -p "$work/case" && cp "$good"/* "$work/case/"; }

# rezip <archive> <edit command...>: unpacks a zip, runs the command in the unpacked folder, repacks.
rezip() {
  local zip=$1 dir=$work/unzip
  shift
  rm -rf "$dir" && mkdir -p "$dir"
  unzip -q "$zip" -d "$dir"
  (cd "$dir" && "$@")
  rm -f "$zip"
  (cd "$dir" && zip -qr "$zip" .)
}
# retar <tgz> <edit command...>: the same for the Unity tarball (package/ prefix).
retar() {
  local tgz=$1 dir=$work/untar
  shift
  rm -rf "$dir" && mkdir -p "$dir"
  tar -xzf "$tgz" -C "$dir"
  (cd "$dir" && "$@")
  tar -czf "$tgz" -C "$dir" package
}

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

unity=com.mumble-speech.unity-$version.tgz

# --- Cases -------------------------------------------------------------------------------------
# check.sh is given Plugins/Android/libs, which also holds the ABI folders' .meta files: they are allowed.
copy_archives
expect_exit "intact archives verify" 0 "all release archives verified" "$verify" "$version" "$work/case" "$stubs/godot"

copy_archives
retar "$work/case/$unity" rm package/Plugins/Android/libs/x86_64/libmumble_ffi.so
expect_exit "Unity tarball without one Android library" 1 \
  "missing Plugins/Android/libs/x86_64/libmumble_ffi.so or its .meta" "$verify" "$version" "$work/case" "$stubs/godot"

copy_archives
retar "$work/case/$unity" rm package/Plugins/Android/libs/armeabi-v7a/libmumble_ffi.so.meta
expect_exit "Unity tarball without the .meta of an Android library" 1 \
  "missing Plugins/Android/libs/armeabi-v7a/libmumble_ffi.so or its .meta" "$verify" "$version" "$work/case" "$stubs/godot"

copy_archives
rezip "$work/case/mumble-speech-c-$version.zip" sh -c "mkdir -p mumble-speech-c-$version/lib/android-arm64 && echo x > mumble-speech-c-$version/lib/android-arm64/libmumble_ffi.so"
expect_exit "Android library in the C archive" 1 "Android files in the C archive" "$verify" "$version" "$work/case" "$stubs/godot"

copy_archives
rezip "$work/case/mumble-speech-godot-$version.zip" sh -c "mkdir -p addons/mumble_speech/bin/android && echo x > addons/mumble_speech/bin/android/libmumble_godot.so"
expect_exit "Android library in the Godot addon" 1 "Android files in the Godot addon" "$verify" "$version" "$work/case" "$stubs/godot"

# The Godot web library (L4.15, L4.17, W5).
copy_archives
rezip "$work/case/mumble-speech-godot-$version.zip" rm addons/mumble_speech/bin/mumble_godot.wasm
expect_exit "Godot addon without the web library" 1 "missing mumble_godot.wasm in the Godot addon" "$verify" "$version" "$work/case" "$stubs/godot"

copy_archives
rezip "$work/case/mumble-speech-godot-$version.zip" cp "$work/wasm-fixtures/shared-memory.wasm" addons/mumble_speech/bin/mumble_godot.wasm
expect_exit "Godot addon with a threaded web library (shared memory)" 1 "shared memory" "$verify" "$version" "$work/case" "$stubs/godot"

copy_archives
rezip "$work/case/mumble-speech-godot-$version.zip" cp "$work/wasm-fixtures/atomics.wasm" addons/mumble_speech/bin/mumble_godot.wasm
expect_exit "Godot addon with a threaded web library (atomics)" 1 "atomics instruction" "$verify" "$version" "$work/case" "$stubs/godot"

copy_archives
rezip "$work/case/mumble-speech-godot-$version.zip" cp "$work/wasm-fixtures/no-dylink.wasm" addons/mumble_speech/bin/mumble_godot.wasm
expect_exit "Godot addon with a web library that is not a side module" 1 'no "dylink.0" section' "$verify" "$version" "$work/case" "$stubs/godot"

copy_archives
rezip "$work/case/mumble-speech-godot-$version.zip" sed -i.bak '/^web\./d' addons/mumble_speech/mumble_speech.gdextension
expect_exit "Godot addon whose .gdextension has no web entries" 1 "web.debug.wasm32 is missing" "$verify" "$version" "$work/case" "$stubs/godot"

copy_archives
rezip "$work/case/mumble-speech-c-$version.zip" sh -c "cp $work/wasm-fixtures/good.wasm mumble-speech-c-$version/mumble_godot.wasm"
expect_exit "WebAssembly library in the C archive" 1 "WebAssembly files in the C archive" "$verify" "$version" "$work/case" "$stubs/godot"

copy_archives
retar "$work/case/$unity" cp "$work/wasm-fixtures/good.wasm" package/Plugins/mumble_godot.wasm
expect_exit "WebAssembly library in the Unity package" 1 "WebAssembly files in the Unity package" "$verify" "$version" "$work/case" "$stubs/godot"

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
