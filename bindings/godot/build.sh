#!/usr/bin/env sh
# Builds the GDExtension and copies it into the addon (specs/design.md §9.3).
# Usage: bindings/godot/build.sh            (release build for this machine)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
cargo build -p mumble-godot --release --manifest-path "$root/Cargo.toml"
bin="$here/addons/mumble_speech/bin"
mkdir -p "$bin"
for lib in libmumble_godot.so libmumble_godot.dylib mumble_godot.dll; do
  if [ -f "$root/target/release/$lib" ]; then
    cp "$root/target/release/$lib" "$bin/"
    echo "copied $lib"
  fi
done
