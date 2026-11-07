#!/usr/bin/env bash
# Exports the Godot project of the binding to the web with a given Godot editor binary
# (specs/design.md §9.3.1, §9.3.2, L4.15, L4.19, LD31, LD32, LD39). The web libraries must already be in the
# addon: bindings/godot/addons/mumble_speech/bin/mumble_godot.wasm and mumble_godot.threads.wasm
# (scripts/godot-web/build.sh, or the release zip).
# Usage: scripts/godot-web/export.sh <godot binary> <out dir> [preset]
#   preset: "Web (tests)" (default, the test runner), "Web" (the example scene), "Web (threads tests)" or
#           "Web (threads)" (the same two with Thread Support on).
# Environment:
#   GODOT_PROJECT         the Godot project to export (default: bindings/godot); the release check points
#                         it at the packaged addon in a copy of the project
#   GODOT_TEMPLATE_CACHE  where the four dlink web templates (threaded and non-threaded) of each Godot version
#                         are kept
#                         (default: ~/.cache/mumble-godot-web-templates); CI caches it
# The export fails unless <out dir> has index.html and exactly one library: mumble_godot.threads.wasm when the
# preset has variant/thread_support=true (read from the project's export_presets.cfg), mumble_godot.wasm
# otherwise (Godot copies only the library its feature tags select, LD35).
set -euo pipefail

if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: export.sh <godot binary> <out dir> [preset]" >&2
  exit 2
fi
godot=$1
mkdir -p "$2"
out=$(cd "$2" && pwd)
preset=${3-Web (tests)} # an empty name is an unknown preset, not the default (${3:-...} would take it for unset)
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

# Whether the preset has Thread Support on: variant/thread_support in the [preset.N.options] of the preset
# with that name. Prints "true" or "false"; fails when the file, the preset or the key is missing.
presets=$project/export_presets.cfg
if [ ! -f "$presets" ]; then
  echo "error: $presets not found" >&2
  exit 1
fi
thread_support=$(awk -v want="$preset" '
  { sub(/\r$/, "") } # a presets file with CRLF line ends (a Windows checkout) is read like an LF one
  /^\[preset\.[0-9]+\]$/ { id = $0; sub(/^\[/, "", id); sub(/\]$/, "", id); current = ""; next }
  /^name="/ { n = $0; sub(/^name="/, "", n); sub(/"[[:space:]]*$/, "", n); if (n == want) current = id; next }
  /^\[preset\.[0-9]+\.options\]$/ { opts = $0; sub(/^\[/, "", opts); sub(/\.options\]$/, "", opts); inopts = (opts == current && current != ""); next }
  /^\[/ { inopts = 0; next }
  inopts && /^variant\/thread_support=/ { v = $0; sub(/^[^=]*=/, "", v); sub(/[[:space:]]*$/, "", v); print v; exit }
' "$presets")
case $thread_support in
  true) library=mumble_godot.threads.wasm; other=mumble_godot.wasm ;;
  false) library=mumble_godot.wasm; other=mumble_godot.threads.wasm ;;
  *) echo "error: preset '$preset' with a variant/thread_support value not found in $presets" >&2; exit 1 ;;
esac

# The four templates of the builds with Extensions Support ("dlink"): threaded and non-threaded, release and debug.
templates=$cache/$tag
missing_template=0
for t in web_dlink_release web_dlink_debug web_dlink_nothreads_release web_dlink_nothreads_debug; do
  [ -f "$templates/$t.zip" ] || missing_template=1
done
if [ "$missing_template" -eq 1 ]; then
  mkdir -p "$templates"
  tpz=$(mktemp)
  trap 'rm -f "$tpz"' EXIT
  curl -fSL --retry 3 -o "$tpz" "https://github.com/godotengine/godot-builds/releases/download/$tag/Godot_v${tag}_export_templates.tpz"
  unzip -j -o -q "$tpz" 'templates/web_dlink_*.zip' -d "$templates"
  rm -f "$tpz"
fi
case $(uname -s) in
  Darwin) data=$HOME/Library/Application\ Support/Godot ;;
  *) data=${XDG_DATA_HOME:-$HOME/.local/share}/godot ;;
esac
installed=$data/export_templates/$version
mkdir -p "$installed"
cp "$templates"/web_dlink_*.zip "$installed/"
printf '%s' "$version" > "$installed/version.txt"

# The vectors go into the export of the test runner (a copy, git-ignored).
mkdir -p "$project/tests/web"
cp "$vectors" "$project/tests/web/vectors.json"

"$godot" --headless --path "$project" --import >/dev/null 2>&1 || true
rm -rf "$out"/* 2>/dev/null || true
"$godot" --headless --path "$project" --export-release "$preset" "$out/index.html"

if [ ! -f "$out/index.html" ] || [ ! -f "$out/$library" ]; then
  echo "error: the export has no ${library} next to index.html: is the web library in the addon (bin/$library) and Extensions Support on?" >&2
  ls -l "$out" >&2
  exit 1
fi
if [ -f "$out/$other" ]; then
  echo "error: the export of '$preset' (thread_support=$thread_support) also has $other: it must have $library only (LD35)" >&2
  ls -l "$out" >&2
  exit 1
fi
ls -l "$out"
echo "exported '$preset' to $out ($library)"
