#!/usr/bin/env sh
# Builds the C ABI library for the three Android ABIs with cargo-ndk (specs/design.md §9.4.1, L4.13).
# Usage: scripts/android/build.sh <out dir>
#   writes <out dir>/{arm64-v8a,armeabi-v7a,x86_64}/libmumble_ffi.so
# Requires ANDROID_NDK_HOME (or ANDROID_NDK_ROOT) and cargo-ndk (cargo install cargo-ndk --locked).
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <out dir>" >&2
  exit 2
fi

ndk=${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}
if [ -z "$ndk" ]; then
  echo "build.sh: set ANDROID_NDK_HOME (or ANDROID_NDK_ROOT) to the Android NDK directory" >&2
  exit 1
fi
if [ ! -d "$ndk" ]; then
  echo "build.sh: ANDROID_NDK_HOME ($ndk) is not a directory" >&2
  exit 1
fi
export ANDROID_NDK_HOME=$ndk

if ! cargo ndk --version >/dev/null 2>&1; then
  echo "build.sh: cargo-ndk not found; install it with: cargo install cargo-ndk --locked" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$1"
out=$(cd "$1" && pwd)

# Minimum API level 21 (Android 5.0, LD22).
api=21

rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android

cd "$root"
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -P "$api" -o "$out" build --release -p mumble-ffi
