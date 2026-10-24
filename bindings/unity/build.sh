#!/usr/bin/env sh
# Builds the C ABI library and copies it into Plugins/ for this machine (specs/design.md §9.4).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
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
esac
