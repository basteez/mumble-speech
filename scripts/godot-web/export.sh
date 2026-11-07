#!/usr/bin/env bash
# Exports the Godot project of the binding to the web with a given Godot editor binary
# (specs/design.md §9.3.1, L4.15, LD31, LD32). The web library must already be in the addon:
# bindings/godot/addons/mumble_speech/bin/mumble_godot.wasm (scripts/godot-web/build.sh, or the release zip).
# Usage: scripts/godot-web/export.sh <godot binary> <out dir> [preset]
#   preset: "Web (tests)" (default, the test runner) or "Web" (the example scene).
# Environment:
#   GODOT_PROJECT         the Godot project to export (default: bindings/godot); the release check points
#                         it at the packaged addon in a copy of the project
#   GODOT_TEMPLATE_CACHE  where the two non-threaded dlink web templates of each Godot version are kept
#                         (default: ~/.cache/mumble-godot-web-templates); CI caches it
# The export fails unless <out dir> has index.html and mumble_godot.wasm.
set -euo pipefail

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: export.sh <godot binary> <out dir> [preset]" >&2
  exit 2
fi
godot=$1
mkdir -p "$2"
out=$(cd "$2" && pwd)
preset=${3:-Web (tests)}
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
project=${GODOT_PROJECT:-$root/bindings/godot}
vectors=${GODOT_VECTORS:-$root/conformance/vectors.json}
cache=${GODOT_TEMPLATE_CACHE:-$HOME/.cache/mumble-godot-web-templates}

# "4.3.stable.official.77dcf97d8" -> "4.3.stable" (the name of Godot's template folder).
full=$("$godot" --version | head -n 1)
version=$(printf '%s' "$full" | sed -E 's/^([0-9]+\.[0-9]+(\.[0-9]+)?\.(stable|(beta|rc|dev)[0-9]*)).*/\1/')
case $version in
  *.stable) ;;
  *) echo "error: '$full' is not a stable Godot release; the templates are fetched for stable releases only" >&2; exit 1 ;;
esac
tag=$(printf '%s' "$version" | sed -E 's/\.stable$/-stable/')
echo "Godot $version"

# The two templates of the non-threaded build with Extensions Support ("dlink").
templates=$cache/$tag
if [ ! -f "$templates/web_dlink_nothreads_release.zip" ] || [ ! -f "$templates/web_dlink_nothreads_debug.zip" ]; then
  mkdir -p "$templates"
  tpz=$(mktemp)
  trap 'rm -f "$tpz"' EXIT
  curl -fSL --retry 3 -o "$tpz" "https://github.com/godotengine/godot-builds/releases/download/$tag/Godot_v${tag}_export_templates.tpz"
  unzip -j -o -q "$tpz" 'templates/web_dlink_nothreads_*.zip' -d "$templates"
  rm -f "$tpz"
fi
case $(uname -s) in
  Darwin) data=$HOME/Library/Application\ Support/Godot ;;
  *) data=${XDG_DATA_HOME:-$HOME/.local/share}/godot ;;
esac
installed=$data/export_templates/$version
mkdir -p "$installed"
cp "$templates"/web_dlink_nothreads_*.zip "$installed/"
printf '%s' "$version" > "$installed/version.txt"

# The vectors go into the export of the test runner (a copy, git-ignored).
mkdir -p "$project/tests/web"
cp "$vectors" "$project/tests/web/vectors.json"

"$godot" --headless --path "$project" --import >/dev/null 2>&1 || true
rm -rf "$out"/* 2>/dev/null || true
"$godot" --headless --path "$project" --export-release "$preset" "$out/index.html"

for f in index.html mumble_godot.wasm; do
  if [ ! -f "$out/$f" ]; then
    echo "error: the export has no $f: is the web library in the addon (bin/mumble_godot.wasm) and Extensions Support on?" >&2
    ls -l "$out" >&2
    exit 1
  fi
done
ls -l "$out"
echo "exported '$preset' to $out"
