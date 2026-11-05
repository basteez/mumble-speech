// Tests of scripts/release/notes.mjs: where Android appears in the release notes (specs/tasks.md N5,
// L8.3): in the Unity package's download row and compatibility row only. Run with: node --test scripts/release/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'notes.mjs');
// A version that never gets a CHANGELOG section, so the notes show Unreleased as a preview
// whatever has been released (the real changelog is read).
const version = '99.0.0';
const archivesOf = (v) => ({
  web: `mumble-speech-web-${v}.tgz`,
  godot: `mumble-speech-godot-${v}.zip`,
  unity: `com.mumble-speech.unity-${v}.tgz`,
  c: `mumble-speech-c-${v}.zip`,
});
const archives = archivesOf(version);

// Runs notes.mjs on a folder holding the four archives (contents are fixed bytes per file).
function compose(extraArgs = [], names = Object.values(archives), v = version) {
  const dir = mkdtempSync(join(tmpdir(), 'notes-test-'));
  const archivesDir = join(dir, 'archives');
  mkdirSync(archivesDir);
  for (const name of names) writeFileSync(join(archivesDir, name), `contents of ${name}\n`);
  const notesFile = join(dir, 'notes.md');
  const result = spawnSync(process.execPath, [script, v, archivesDir, notesFile, ...extraArgs], { encoding: 'utf8' });
  const notes = result.status === 0 ? readFileSync(notesFile, 'utf8') : '';
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { result, notes, archivesDir, cleanup };
}

// The table rows that mention a file name, e.g. the download row of one archive.
const rowsFor = (notes, name) => notes.split('\n').filter((line) => line.startsWith('|') && line.includes(name));

test('the Unity download row lists Android with its three ABIs', () => {
  const { result, notes, cleanup } = compose();
  try {
    assert.equal(result.status, 0, result.stderr);
    const [row] = rowsFor(notes, archives.unity);
    assert.ok(row, 'no download row for the Unity package');
    assert.match(row, /Windows x64, macOS universal, Linux x64, Android \(arm64-v8a, armeabi-v7a, x86_64\)/);
  } finally {
    cleanup();
  }
});

test('Android appears in the download table for the Unity package only', () => {
  const { result, notes, cleanup } = compose();
  try {
    assert.equal(result.status, 0, result.stderr);
    const downloads = notes.slice(notes.indexOf('## Downloads'), notes.indexOf('<details>'));
    const android = downloads.split('\n').filter((line) => /android/i.test(line));
    assert.equal(android.length, 1, `Android in ${android.length} download rows:\n${android.join('\n')}`);
    assert.ok(android[0].includes(archives.unity));
    for (const name of [archives.godot, archives.c, archives.web]) {
      assert.deepEqual(rowsFor(downloads, name).filter((line) => /android/i.test(line)), [], `Android in the row of ${name}`);
    }
  } finally {
    cleanup();
  }
});

test('the compatibility table has Android for Unity and not for Godot or the C ABI', () => {
  const { result, notes, cleanup } = compose();
  try {
    assert.equal(result.status, 0, result.stderr);
    const compat = notes.slice(notes.indexOf('## Compatibility'), notes.indexOf('## Verification'));
    const unity = compat.split('\n').find((line) => line.startsWith('| Unity |'));
    assert.equal(unity, '| Unity | 2022.3 or later, desktop and Android 5.0 (API level 21) or later |');
    const godot = compat.split('\n').find((line) => line.startsWith('| Godot |'));
    assert.ok(godot && !/android/i.test(godot), `Godot row: ${godot}`);
    const native = compat.split('\n').find((line) => line.startsWith('| Native platforms |'));
    assert.ok(native && !/android/i.test(native), `native platforms row: ${native}`);
  } finally {
    cleanup();
  }
});

test('the Unity install line is the Unity tarball, and the checksums cover every archive', () => {
  const { result, notes, archivesDir, cleanup } = compose();
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(notes, new RegExp(`with \`${archives.unity.replaceAll('.', '\\.')}\``));
    const sums = readFileSync(join(archivesDir, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
    assert.equal(sums.length, 4);
    const unity = sums.find((line) => line.endsWith(`  ${archives.unity}`));
    const bytes = readFileSync(join(archivesDir, archives.unity));
    assert.equal(unity, `${createHash('sha256').update(bytes).digest('hex')}  ${archives.unity}`);
  } finally {
    cleanup();
  }
});

test('the Unity row is absent when the Unity tarball is missing', () => {
  // Negative: without the tarball there is no Android download to advertise.
  const names = [archives.web, archives.godot, archives.c];
  const { result, notes, cleanup } = compose([], names);
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(rowsFor(notes, archives.unity), []);
  } finally {
    cleanup();
  }
});

test('--require-changelog fails when the version has no CHANGELOG section', () => {
  const { result, cleanup } = compose(['--require-changelog']);
  try {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CHANGELOG\.md has no section for 99\.0\.0/);
  } finally {
    cleanup();
  }
});

test('a version without a CHANGELOG section previews Unreleased', () => {
  const { result, notes, cleanup } = compose();
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(notes, /Preview: CHANGELOG\.md has no 99\.0\.0 section yet, showing \*Unreleased\*/);
  } finally {
    cleanup();
  }
});

test('0.2.0 uses its own CHANGELOG section, which mentions Android (L8.4)', () => {
  const v = '0.2.0';
  const { result, notes, cleanup } = compose(['--require-changelog'], Object.values(archivesOf(v)), v);
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(notes, /Preview:/);
    assert.match(notes, /Unity on Android/);
  } finally {
    cleanup();
  }
});
