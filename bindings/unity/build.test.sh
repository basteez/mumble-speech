#!/usr/bin/env bash
# Negative tests of bindings/unity/build.sh (specs/tasks.md N1): the android argument without an NDK,
# unknown arguments, and the desktop path with no argument. Nothing is built: uname and cargo are
# stubs on PATH, and build.sh runs from a copy of its folder, so the repository is not touched.
# Usage: bindings/unity/build.test.sh   (no arguments; runs locally and in CI)
set -uo pipefail

src=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0
passed=0

# A stub bin folder: uname says Linux; cargo logs its arguments, writes the library cargo would
# build, and fails when FAKE_CARGO_FAIL is set. Without cargo-ndk, "cargo ndk" fails as cargo does.
stubs=$work/stubs
mkdir -p "$stubs" "$work/repo/bindings/unity/Plugins/Linux/x86_64" "$work/repo/target/release"
cp "$src/build.sh" "$work/repo/bindings/unity/build.sh"
cp -R "$src/../../scripts" "$work/repo/scripts"
: > "$work/repo/Cargo.toml"
printf '#!/bin/sh\necho Linux\n' > "$stubs/uname"
cat > "$stubs/cargo" <<EOF
#!/bin/sh
echo "cargo \$*" >> "$work/cargo.log"
[ "\$1" != ndk ] || { echo "error: no such command: \`ndk\`" >&2; exit 101; }
[ -z "\${FAKE_CARGO_FAIL:-}" ] || exit 3
echo "fake library" > "$work/repo/target/release/libmumble_ffi.so"
EOF
chmod +x "$stubs/uname" "$stubs/cargo"

# A PATH that has the stubs and the system tools, but no cargo-ndk, rustup or NDK.
stubbed_path=$stubs:/usr/bin:/bin

# expect_exit <label> <exit status> <message fragment> <command...>
expect_exit() {
  local label=$1 code=$2 fragment=$3 got
  shift 3
  "$@" > "$work/out.txt" 2>&1
  got=$?
  if [ "$got" -ne "$code" ]; then
    echo "FAIL $label: exit $got, expected $code:"; cat "$work/out.txt"; failed=$((failed + 1))
  elif [ -n "$fragment" ] && ! grep -qF -- "$fragment" "$work/out.txt"; then
    echo "FAIL $label: no message containing '$fragment':"; cat "$work/out.txt"; failed=$((failed + 1))
  else
    echo "ok   $label"; passed=$((passed + 1))
  fi
}

build=$work/repo/bindings/unity/build.sh

# android without an NDK: the NDK variables are removed from the environment.
expect_exit "android without ANDROID_NDK_HOME or ANDROID_NDK_ROOT" 1 "ANDROID_NDK_HOME" \
  env -u ANDROID_NDK_HOME -u ANDROID_NDK_ROOT PATH="$stubbed_path" "$build" android
expect_exit "android without an NDK does not touch the plugins folder" 0 "" \
  test ! -e "$work/repo/bindings/unity/Plugins/Android"
expect_exit "android with ANDROID_NDK_ROOT pointing nowhere" 1 "is not a directory" \
  env -u ANDROID_NDK_HOME ANDROID_NDK_ROOT="$work/no-such-ndk" PATH="$stubbed_path" "$build" android
expect_exit "android with an NDK but no cargo-ndk" 1 "cargo-ndk not found" \
  env -u ANDROID_NDK_ROOT ANDROID_NDK_HOME="$work" PATH="$stubbed_path" "$build" android

# Unknown arguments are usage errors (exit 2), with or without an NDK.
expect_exit "unknown argument" 2 "usage" env -u ANDROID_NDK_HOME -u ANDROID_NDK_ROOT PATH="$stubbed_path" "$build" bogus
expect_exit "unknown option" 2 "usage" env PATH="$stubbed_path" "$build" --help
# Arguments after android are usage errors too.
expect_exit "extra argument after android" 2 "usage" \
  env -u ANDROID_NDK_HOME -u ANDROID_NDK_ROOT PATH="$stubbed_path" "$build" android extra
expect_exit "extra argument after android, NDK set" 2 "usage" \
  env ANDROID_NDK_HOME="$work" PATH="$stubbed_path" "$build" android extra

# No argument: the desktop library is built with cargo and copied into Plugins/Linux/x86_64.
rm -f "$work/cargo.log"
expect_exit "no argument builds the desktop library" 0 "copied Plugins/Linux/x86_64/libmumble_ffi.so" \
  env -u ANDROID_NDK_HOME -u ANDROID_NDK_ROOT PATH="$stubbed_path" "$build"
if [ -f "$work/repo/bindings/unity/Plugins/Linux/x86_64/libmumble_ffi.so" ] \
  && grep -qF -- "cargo build -p mumble-ffi --release --manifest-path $work/repo/Cargo.toml" "$work/cargo.log" \
  && [ "$(wc -l < "$work/cargo.log" | tr -d ' ')" -eq 1 ]; then
  echo "ok   desktop path runs one cargo build and copies the library"; passed=$((passed + 1))
else
  echo "FAIL desktop path: cargo log and copied library do not match:"; cat "$work/cargo.log" 2>/dev/null
  failed=$((failed + 1))
fi
if [ ! -e "$work/repo/bindings/unity/Plugins/Android" ]; then
  echo "ok   desktop path does not create the Android folder"; passed=$((passed + 1))
else
  echo "FAIL desktop path created the Android folder"; failed=$((failed + 1))
fi

# A failing cargo build stops the desktop path with an error.
expect_exit "desktop build failure stops the script" 3 "" \
  env FAKE_CARGO_FAIL=1 PATH="$stubbed_path" "$build"

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
