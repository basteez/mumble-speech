// Composes the release notes and SHA256SUMS.txt (specs/design.md §13, L8.3, L8.4).
// Every value comes from the repository or the archives: nothing here is written by hand.
//
// Usage: node scripts/release/notes.mjs <version> <archives dir> <notes file>
//          [--require-changelog] [--run-url <url>] [--generated <file with GitHub's generated notes>]
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [version, archivesDir, notesFile, ...rest] = process.argv.slice(2);
if (!version || !archivesDir || !notesFile) {
  console.error('usage: notes.mjs <version> <archives dir> <notes file> [--require-changelog] [--run-url URL] [--generated FILE]');
  process.exit(2);
}
const option = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const requireChangelog = rest.includes('--require-changelog');
const runUrl = option('--run-url');
const generatedFile = option('--generated');

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const repo = process.env.GITHUB_REPOSITORY ?? 'basteez/mumble-speech';
const site = 'https://mumble-speech.github.io';
const tag = `v${version}`;

// --- Changelog section (L8.4) ---------------------------------------------------------------
function changelogSection(changelog, heading) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${heading}]`));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && (l.startsWith('## [') || /^\[[^\]]+\]: /.test(l)));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}
// GitHub renders single newlines in release notes as line breaks: join wrapped lines of
// paragraphs and list items so they read as written.
function unwrap(markdown) {
  const out = [];
  let fence = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    const prev = out[out.length - 1];
    const continues =
      !fence && prev !== undefined && prev.trim() !== '' && !/^(#|\||```)/.test(prev) &&
      line.trim() !== '' && !/^\s*(- |\* |\d+\. |#|>|\||```)/.test(line);
    if (continues) out[out.length - 1] = `${prev} ${line.trim()}`;
    else out.push(line);
  }
  return out.join('\n');
}
const changelog = read('CHANGELOG.md');
let changes = changelogSection(changelog, version);
let changesNote = '';
if (changes === null) {
  if (requireChangelog) {
    console.error(`CHANGELOG.md has no section for ${version} (L8.4)`);
    process.exit(1);
  }
  changes = changelogSection(changelog, 'Unreleased') || '_No changes listed under Unreleased._';
  changesNote = `> Preview: CHANGELOG.md has no ${version} section yet, showing *Unreleased*.\n\n`;
}
changes = unwrap(changes);

// --- Archives and checksums --------------------------------------------------------------------
const DESCRIPTIONS = [
  [/^mumble-speech-web-/, 'npm package `@mumble-speech/web` (WebAssembly inlined)', 'Browsers, Node ≥ 20'],
  [/^mumble-speech-godot-/, 'Godot addon `addons/mumble_speech`', 'Windows x64, macOS universal, Linux x64'],
  [/^com\.mumble-speech\.unity-/, 'Unity package (UPM tarball, native plugins included)', 'Windows x64, macOS universal, Linux x64'],
  [/^mumble-speech-c-/, 'C ABI: `mumble.h` and shared libraries', 'Windows x64, macOS universal, Linux x64'],
];
const files = readdirSync(archivesDir)
  .filter((f) => f !== 'SHA256SUMS.txt' && statSync(join(archivesDir, f)).isFile())
  .sort((a, b) => DESCRIPTIONS.findIndex(([re]) => re.test(a)) - DESCRIPTIONS.findIndex(([re]) => re.test(b)));
const assets = files.map((file) => {
  const bytes = readFileSync(join(archivesDir, file));
  const [, what, platforms] = DESCRIPTIONS.find(([re]) => re.test(file)) ?? [null, file, ''];
  return { file, what, platforms, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
writeFileSync(join(archivesDir, 'SHA256SUMS.txt'), assets.map((a) => `${a.sha256}  ${a.file}\n`).join(''));
const url = (file) => `https://github.com/${repo}/releases/download/${tag}/${file}`;
const fileOf = (re) => assets.find((a) => re.test(a.file))?.file ?? '(missing)';
const size = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

// --- Compatibility, read from the repository ------------------------------------------------------
const abiVersion = read('bindings/c/include/mumble.h').match(/#define MUMBLE_ABI_VERSION (\d+)/)[1];
const vectors = JSON.parse(read('conformance/vectors.json'));
const godotMinimum = read('bindings/godot/addons/mumble_speech/mumble_speech.gdextension').match(/compatibility_minimum = ([\d.]+)/)[1];
const unityMinimum = JSON.parse(read('bindings/unity/package.json')).unity;
const nodeEngines = JSON.parse(read('packages/web/package.json')).engines.node;

const generated = generatedFile ? readFileSync(generatedFile, 'utf8').trim() : '';

// Where this version is published (L8.3). Entries that need manual approval come from registries.json.
const registries = JSON.parse(read('scripts/release/registries.json'));
const packages = [
  ['npm', '`@mumble-speech/web`', `https://www.npmjs.com/package/@mumble-speech/web/v/${version}`],
  ['crates.io', '`mumble-speech`', `https://crates.io/crates/mumble-speech/${version}`],
  ['docs.rs', 'Rust API reference', `https://docs.rs/mumble-speech/${version}`],
  ['Unity (git URL)', `branch \`upm\`, tag \`upm/${tag}\``, `https://github.com/${repo}/tree/upm/${tag}`],
  ['OpenUPM', '`com.mumble-speech.unity`', registries.openupm],
  ['Godot (git)', `branch \`godot-addon\`, tag \`godot/${tag}\``, `https://github.com/${repo}/tree/godot/${tag}`],
  ['Godot Asset Library', 'Mumble Speech', registries.godotAssetLibrary],
].filter(([, , link]) => link);

const notes = `**mumble-speech ${version}**: video-game mumble speech generated at runtime, for the web, Godot, Unity and C.

[Documentation](${site}/) · [Playground](${site}/playground/) · [Changelog](${site}/changelog) · [Report an issue](https://github.com/${repo}/issues)

## What's new

${changesNote}${changes}

## Packages

| Where | What | Link |
|---|---|---|
${packages.map(([where, what, link]) => `| ${where} | ${what} | ${link} |`).join('\n')}

## Downloads

| File | What | Platforms | Size |
|---|---|---|---|
${assets.map((a) => `| [\`${a.file}\`](${url(a.file)}) | ${a.what} | ${a.platforms} | ${size(a.size)} |`).join('\n')}

<details><summary>SHA-256 checksums</summary>

\`\`\`
${assets.map((a) => `${a.sha256}  ${a.file}`).join('\n')}
\`\`\`

Also attached as \`SHA256SUMS.txt\`: download it next to the archives and run \`sha256sum -c SHA256SUMS.txt\`.
</details>

## Install

**Web** ([docs](${site}/bindings/web))
\`\`\`sh
npm install @mumble-speech/web@${version}
\`\`\`

**Rust** ([docs.rs](https://docs.rs/mumble-speech/${version}))
\`\`\`sh
cargo add mumble-speech@${version}
\`\`\`

**Unity** ([docs](${site}/bindings/unity)): Package Manager → **+** → **Add package from git URL…**
\`\`\`
https://github.com/${repo}.git#upm/v${version}
\`\`\`
or **Add package from tarball…** with \`${fileOf(/^com\.mumble-speech\.unity-/)}\`${registries.openupm ? `, or from [OpenUPM](${registries.openupm}): \`openupm add com.mumble-speech.unity@${version}\`` : ''}.

**Godot** ([docs](${site}/bindings/godot)): unzip \`${fileOf(/^mumble-speech-godot-/)}\` into your project, so that \`addons/mumble_speech/\` sits at its root (also on branch [\`godot-addon\`](https://github.com/${repo}/tree/godot/v${version})).

**C, C++, C#, Python…** ([docs](${site}/bindings/c)): unzip \`${fileOf(/^mumble-speech-c-/)}\`; include \`include/mumble.h\` and link the library for your platform from \`lib/\`.

On macOS, if a downloaded library is blocked, run \`xattr -dr com.apple.quarantine <extracted folder>\`.

## Compatibility

| | |
|---|---|
| Godot | ${godotMinimum} or later, desktop |
| Unity | ${unityMinimum} or later, desktop |
| Web | Node ${nodeEngines}; latest two versions of Chrome, Firefox, Safari (desktop and iOS) |
| Native platforms | Windows x64, macOS universal (Apple Silicon and Intel), Linux x64 |
| C ABI | version ${abiVersion} (\`MUMBLE_ABI_VERSION\`) |
| Conformance vectors | format ${vectors.version}, ${vectors.vectors.length} vectors |

## Verification

Before publishing${runUrl ? ` ([CI run](${runUrl}))` : ''}, the archives of this release were checked on Linux: the C tests linked against the packaged library, the packaged Godot addon passed the headless tests on Godot ${godotMinimum}, every file of the Unity package has a \`.meta\` and the three native plugins are present, and the npm tarball installed in an empty project and rendered a conformance vector. On every change, CI checks that all ${vectors.vectors.length} conformance vectors give bit-identical output through the Rust core (Linux, Windows, macOS), WebAssembly, the C ABI (including macOS x86_64 under Rosetta), Godot and C#.
${generated ? `\n${generated}\n` : ''}`;

writeFileSync(notesFile, notes);
console.log(`wrote ${notesFile} and ${join(archivesDir, 'SHA256SUMS.txt')}`);
