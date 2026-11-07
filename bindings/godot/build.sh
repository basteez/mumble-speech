#!/usr/bin/env sh
# Builds the GDExtension and copies it into the addon (specs/design.md §9.3, §9.3.1).
# Usage: bindings/godot/build.sh        release build for this machine (stable Rust)
#        bindings/godot/build.sh web    both web libraries, without and with threads (pinned nightly Rust and
#                                       Emscripten, L4.15, L4.19)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
bin="$here/addons/mumble_speech/bin"

case "${1:-}" in
  "")
    cargo build -p mumble-godot --release --manifest-path "$root/Cargo.toml"
    mkdir -p "$bin"
    for lib in libmumble_godot.so libmumble_godot.dylib mumble_godot.dll; do
      if [ -f "$root/target/release/$lib" ]; then
        cp "$root/target/release/$lib" "$bin/"
        echo "copied $lib"
      fi
    done
    ;;
  web)
    # Both libraries (the addon lists both, so a missing file would break one kind of export, L4.19, L4.20),
    # each checked in its mode, and the .gdextension (the four web keys).
    "$root/scripts/godot-web/build.sh" "$bin"
    "$root/scripts/godot-web/build.sh" --threads "$bin"
    node "$root/scripts/godot-web/check-wasm.mjs" "$bin/mumble_godot.wasm" \
      --gdextension "$here/addons/mumble_speech/mumble_speech.gdextension"
    node "$root/scripts/godot-web/check-wasm.mjs" "$bin/mumble_godot.threads.wasm" --threads
    ;;
  *)
    echo "usage: build.sh [web]" >&2
    exit 2
    ;;
esac
