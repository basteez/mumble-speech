#!/usr/bin/env bash
# Builds the four release archives from the CI artifacts (specs/design.md §13, L8.1).
# Usage: scripts/release/assemble.sh <version> <artifacts dir> <output dir>
#   <artifacts dir>/native-{linux-x64,windows-x64,macos-universal}/  libraries from the native job
#   <artifacts dir>/web/mumble-speech-web-<version>.tgz                npm pack of @mumble-speech/web
set -euo pipefail

version=$1
artifacts=$(cd "$2" && pwd)
mkdir -p "$3"
out=$(cd "$3" && pwd)
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

linux=$artifacts/native-linux-x64
windows=$artifacts/native-windows-x64
macos=$artifacts/native-macos-universal
licenses=("$root/LICENSE-MIT" "$root/LICENSE-APACHE")

# C archive: header, shared libraries per platform, README, licenses.
c=$work/mumble-speech-c-$version
mkdir -p "$c/include" "$c/lib/linux-x64" "$c/lib/windows-x64" "$c/lib/macos-universal"
cp "$root/bindings/c/include/mumble.h" "$c/include/"
cp "$linux/libmumble_ffi.so" "$c/lib/linux-x64/"
cp "$windows/mumble_ffi.dll" "$windows/mumble_ffi.dll.lib" "$c/lib/windows-x64/"
cp "$macos/libmumble_ffi.dylib" "$c/lib/macos-universal/"
cp "$root/bindings/c/README.md" "${licenses[@]}" "$c/"
(cd "$work" && zip -qr "$out/mumble-speech-c-$version.zip" "mumble-speech-c-$version")

# Godot addon: addons/mumble_speech with bin/ for the three platforms.
g=$work/godot
mkdir -p "$g/addons/mumble_speech/bin"
cp "$root/bindings/godot/addons/mumble_speech/mumble_speech.gdextension" "$g/addons/mumble_speech/"
cp "$linux/libmumble_godot.so" "$windows/mumble_godot.dll" "$macos/libmumble_godot.dylib" "$g/addons/mumble_speech/bin/"
cp "$root/bindings/godot/README.md" "${licenses[@]}" "$g/addons/mumble_speech/"
(cd "$g" && zip -qr "$out/mumble-speech-godot-$version.zip" addons)

# Unity package: the UPM folder with Plugins/ filled, as an npm-style tarball (package/ prefix).
u=$work/unity/package
mkdir -p "$u"
(cd "$root/bindings/unity" && tar --exclude='./DotnetTests~' --exclude='./.gitignore' --exclude='./build.sh' --exclude='./build.sh.meta' -cf - .) | (cd "$u" && tar -xf -)
cp "$macos/libmumble_ffi.dylib" "$u/Plugins/macOS/"
cp "$windows/mumble_ffi.dll" "$u/Plugins/Windows/x86_64/"
cp "$linux/libmumble_ffi.so" "$u/Plugins/Linux/x86_64/"
for license in "${licenses[@]}"; do
  name=$(basename "$license")
  cp "$license" "$u/$name.md"
  # Immutable packages need a .meta for every file; a deterministic GUID keeps it stable across releases.
  guid=$(printf 'com.mumble-speech.unity/%s' "$name" | md5sum | cut -c1-32)
  printf 'fileFormatVersion: 2\nguid: %s\nTextScriptImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n' "$guid" > "$u/$name.md.meta"
done
tar -czf "$out/com.mumble-speech.unity-$version.tgz" -C "$work/unity" package

# npm tarball, as produced by npm pack.
cp "$artifacts/web/mumble-speech-web-$version.tgz" "$out/"

ls -l "$out"
