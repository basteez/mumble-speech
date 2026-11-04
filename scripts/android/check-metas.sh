#!/usr/bin/env sh
# Checks the Unity import settings of the Android libraries (specs/design.md §9.4.1, L4.13).
# Usage: scripts/android/check-metas.sh <package dir>   (bindings/unity or an extracted package)
# Fails unless each Plugins/Android/libs/<abi>/libmumble_ffi.so.meta enables Android only, with
# the CPU of its folder, and no other plugin .meta enables Android (or every platform).
set -u

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <package dir>" >&2
  exit 2
fi
pkg=$1
[ -d "$pkg/Plugins" ] || { echo "check-metas.sh: $pkg/Plugins not found" >&2; exit 2; }

failures=0
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
fail() {
  echo "check-metas.sh: FAIL: $*" >&2
  failures=$((failures + 1))
}

# Prints "<platform key>|<enabled>|<CPU>" for every platformData entry of a PluginImporter .meta.
entries() {
  awk '
    function flush() { if (key != "") print key "|" enabled "|" cpu; key = ""; enabled = ""; cpu = "" }
    /^  platformData:/ { inside = 1; next }
    inside && /^  [A-Za-z]/ { flush(); inside = 0 }
    !inside { next }
    /^  - first:/ { flush(); want = 1; next }
    want && /^      [^ ]/ { key = $0; sub(/^ +/, "", key); sub(/ +$/, "", key); want = 0; next }
    /^      enabled:/ { enabled = $2; next }
    /^        CPU:/ { cpu = $2; next }
    END { flush() }
  ' "$1"
}

for abi in arm64-v8a armeabi-v7a x86_64; do
  case $abi in
    arm64-v8a) cpu=ARM64 ;;
    armeabi-v7a) cpu=ARMv7 ;;
    x86_64) cpu=X86_64 ;;
  esac
  folder=$pkg/Plugins/Android/libs/$abi
  meta=$folder/libmumble_ffi.so.meta
  [ -f "$folder.meta" ] || fail "$abi: folder meta $folder.meta is missing"
  if [ ! -f "$meta" ]; then
    fail "$abi: $meta is missing"
    continue
  fi
  grep -q '^PluginImporter:' "$meta" || fail "$abi: $meta is not a PluginImporter"
  found=no
  for line in $(entries "$meta" | tr ' ' '_'); do
    key=$(printf '%s' "$line" | tr '_' ' ' | cut -d'|' -f1)
    enabled=$(printf '%s' "$line" | cut -d'|' -f2)
    got_cpu=$(printf '%s' "$line" | cut -d'|' -f3)
    if [ "$key" = "Android: Android" ]; then
      found=yes
      [ "$enabled" = 1 ] || fail "$abi: Android is not enabled in $meta"
      [ "$got_cpu" = "$cpu" ] || fail "$abi: Android CPU is '$got_cpu' in $meta, expected $cpu"
    elif [ "$enabled" != 0 ]; then
      fail "$abi: platform '$key' is enabled in $meta (only Android may be)"
    fi
  done
  [ "$found" = yes ] || fail "$abi: no Android entry in $meta"
done

# A binary without its .meta, and the folders above the ABI folders.
for f in "$pkg"/Plugins/Android.meta "$pkg"/Plugins/Android/libs.meta; do
  [ -f "$f" ] || fail "$f is missing"
done
for so in $(find "$pkg/Plugins/Android" -name '*.so' 2>/dev/null); do
  [ -f "$so.meta" ] || fail "$so has no .meta"
done

# No other plugin enables Android or every platform.
find "$pkg/Plugins" -name '*.meta' ! -path "$pkg/Plugins/Android/*" ! -path "$pkg/Plugins/Android.meta" | sort | while read -r meta; do
  grep -q '^PluginImporter:' "$meta" || continue
  entries "$meta" | while IFS='|' read -r key enabled cpu; do
    case $key in
      "Android: Android" | ": Any" | "Any:")
        [ "$enabled" = 1 ] && echo "$meta: '$key' is enabled"
        ;;
    esac
  done
done > "$tmp"
if [ -s "$tmp" ]; then
  while read -r line; do fail "desktop plugin enables Android or every platform: $line"; done < "$tmp"
fi

if [ "$failures" -ne 0 ]; then
  echo "check-metas.sh: $failures problem(s) found" >&2
  exit 1
fi
echo "check-metas.sh: Android import settings are correct"
