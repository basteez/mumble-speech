#!/bin/sh
# Tests of bindings/unity/build.sh on each platform branch, without a Rust toolchain (specs/design.md §9.4,
# L4.12, LD20). uname and cargo are stubs on PATH. build.sh runs from a copy in a scratch tree, so the
# repository is not changed. Lives in scripts/, outside bindings/unity, so it is not in the Unity package.
set -eu

repo=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0

fail() {
  echo "FAIL: $1" >&2
  failures=$((failures + 1))
}

# expect_text <file> <fixed text> <what>
expect_text() {
  grep -F -q -- "$2" "$1" || fail "$3: '$2' not in $(basename "$1")"
}

# run_build <case> <output of uname -s> <exit status of the cargo stub>
# Sets tree (the scratch tree), code (exit status of build.sh), out and err (its standard output and error).
run_build() {
  tree=$work/$1
  mkdir -p "$tree/bindings/unity/Plugins/Linux/x86_64" "$tree/bindings/unity/Plugins/macOS" \
    "$tree/bindings/unity/Plugins/Windows/x86_64" "$tree/target/release" "$tree/stubs"
  cp "$repo/bindings/unity/build.sh" "$tree/bindings/unity/build.sh"
  : > "$tree/Cargo.toml"
  : > "$tree/target/release/libmumble_ffi.so"
  : > "$tree/target/release/mumble_ffi.dll"
  : > "$tree/target/release/libmumble_ffi.dylib"
  printf '#!/bin/sh\necho "%s"\n' "$2" > "$tree/stubs/uname"
  printf '#!/bin/sh\necho "$*" >> "%s"\nexit %s\n' "$tree/cargo-calls.txt" "$3" > "$tree/stubs/cargo"
  chmod +x "$tree/stubs/uname" "$tree/stubs/cargo"
  out=$tree/stdout.txt
  err=$tree/stderr.txt
  code=0
  PATH="$tree/stubs:$PATH" sh "$tree/bindings/unity/build.sh" >"$out" 2>"$err" || code=$?
}

# 1. Unsupported platform: exit status 1, the manual steps on standard error, nothing built or copied.
run_build freebsd FreeBSD 0
[ "$code" -eq 1 ] || fail "FreeBSD: exit status $code, expected 1"
expect_text "$err" "unsupported platform 'FreeBSD'" "FreeBSD"
expect_text "$err" "cargo build -p mumble-ffi --release" "FreeBSD"
expect_text "$err" "target/release/mumble_ffi.dll" "FreeBSD"
expect_text "$err" "target/release/libmumble_ffi.dylib" "FreeBSD"
expect_text "$err" "target/release/libmumble_ffi.so" "FreeBSD"
expect_text "$err" "bindings/unity/Plugins/Windows/x86_64/" "FreeBSD"
expect_text "$err" "bindings/unity/Plugins/macOS/" "FreeBSD"
expect_text "$err" "bindings/unity/Plugins/Linux/x86_64/" "FreeBSD"
[ ! -s "$out" ] || fail "FreeBSD: wrote to standard output: $(cat "$out")"
[ ! -e "$tree/cargo-calls.txt" ] || fail "FreeBSD: cargo was run"

# 2. Linux: reaches the cargo branch with -p mumble-ffi and copies the library into Plugins/.
run_build linux Linux 0
[ "$code" -eq 0 ] || fail "Linux: exit status $code, expected 0"
expect_text "$tree/cargo-calls.txt" "build -p mumble-ffi --release" "Linux"
[ -f "$tree/bindings/unity/Plugins/Linux/x86_64/libmumble_ffi.so" ] || fail "Linux: library not copied"
expect_text "$out" "copied Plugins/Linux/x86_64/libmumble_ffi.so" "Linux"

# 3. Linux with a failing cargo: build.sh fails and copies nothing.
run_build linux-cargo-fails Linux 3
[ "$code" -ne 0 ] || fail "Linux, cargo fails: exit status 0"
[ ! -e "$tree/bindings/unity/Plugins/Linux/x86_64/libmumble_ffi.so" ] || fail "Linux, cargo fails: library copied"

# 4. Windows under Git Bash (MINGW): cargo branch, DLL copied into Plugins/Windows/x86_64/.
run_build windows-gitbash MINGW64_NT-10.0-19045 0
[ "$code" -eq 0 ] || fail "Git Bash: exit status $code, expected 0"
expect_text "$tree/cargo-calls.txt" "build -p mumble-ffi --release" "Git Bash"
[ -f "$tree/bindings/unity/Plugins/Windows/x86_64/mumble_ffi.dll" ] || fail "Git Bash: library not copied"

if [ "$failures" -ne 0 ]; then
  echo "$failures build.sh check(s) failed" >&2
  exit 1
fi
echo "build.sh: unsupported platform fails with the manual steps; Linux and Git Bash branches build and copy"
