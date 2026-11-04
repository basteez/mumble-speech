#!/usr/bin/env sh
# Builds the C ABI library and copies it into Plugins/ (specs/design.md §9.4, §9.4.1).
# Usage: build.sh            the library for this machine (desktop)
#        build.sh android    the Android libraries (needs ANDROID_NDK_HOME and cargo-ndk), checked
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
usage() {
  echo "usage: $0 [android]" >&2
  exit 2
}
[ "$#" -le 1 ] || usage
case "${1:-}" in
  "") ;;
  android)
    "$root/scripts/android/build.sh" "$here/Plugins/Android/libs"
    "$root/scripts/android/check.sh" "$here/Plugins/Android/libs" "$root/bindings/c/include/mumble.h"
    "$root/scripts/android/check-metas.sh" "$here"
    exit 0
    ;;
  *) usage ;;
esac
case "$(uname -s)" in
  Darwin)
    # Universal library, so both Apple Silicon and Intel editors load it.
    rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
    cargo build -p mumble-ffi --release --target aarch64-apple-darwin --manifest-path "$root/Cargo.toml"
    cargo build -p mumble-ffi --release --target x86_64-apple-darwin --manifest-path "$root/Cargo.toml"
    lipo -create -output "$here/Plugins/macOS/libmumble_ffi.dylib" \
      "$root/target/aarch64-apple-darwin/release/libmumble_ffi.dylib" \
      "$root/target/x86_64-apple-darwin/release/libmumble_ffi.dylib"
    echo "copied Plugins/macOS/libmumble_ffi.dylib (universal)"
    ;;
  Linux)
    cargo build -p mumble-ffi --release --manifest-path "$root/Cargo.toml"
    cp "$root/target/release/libmumble_ffi.so" "$here/Plugins/Linux/x86_64/"
    echo "copied Plugins/Linux/x86_64/libmumble_ffi.so"
    ;;
  MINGW* | MSYS* | CYGWIN*)
    cargo build -p mumble-ffi --release --manifest-path "$root/Cargo.toml"
    cp "$root/target/release/mumble_ffi.dll" "$here/Plugins/Windows/x86_64/"
    echo "copied Plugins/Windows/x86_64/mumble_ffi.dll"
    ;;
  *)
    {
      echo "build.sh: unsupported platform '$(uname -s)'. The package supports Windows, macOS and Linux desktop."
      echo "Build the library by hand from the repository root and copy it into Plugins/:"
      echo "  cargo build -p mumble-ffi --release"
      echo "  Windows: target/release/mumble_ffi.dll        -> bindings/unity/Plugins/Windows/x86_64/"
      echo "  macOS:   target/release/libmumble_ffi.dylib   -> bindings/unity/Plugins/macOS/"
      echo "  Linux:   target/release/libmumble_ffi.so      -> bindings/unity/Plugins/Linux/x86_64/"
    } >&2
    exit 1
    ;;
esac
