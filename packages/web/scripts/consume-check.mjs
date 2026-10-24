// External consumption check (L6.2): pack the package, install the tarball in an empty
// project and render a conformance vector through the public API only.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
const vectors = JSON.parse(readFileSync(join(pkg, '..', '..', 'conformance', 'vectors.json'), 'utf8')).vectors;
const vector = vectors.find((v) => v.id === 'alphabet-03');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const work = mkdtempSync(join(tmpdir(), 'mumble-consume-'));
try {
  const tarball = execFileSync(npm, ['pack', '--pack-destination', work], { cwd: pkg, encoding: 'utf8' }).trim().split('\n').pop();
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  execFileSync(npm, ['install', '--no-audit', '--no-fund', join(work, tarball)], { cwd: work, stdio: 'inherit' });
  writeFileSync(
    join(work, 'check.mjs'),
    `import { init, render } from '@mumble-speech/web';
const v = ${JSON.stringify(vector)};
await init();
const r = render(v.text, v.voice, v.sampleRate);
let h = 0xcbf29ce484222325n;
for (const b of new Uint8Array(r.samples.buffer, r.samples.byteOffset, r.samples.byteLength)) {
  h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
}
const hash = '0x' + h.toString(16).padStart(16, '0');
if (r.samples.length !== v.expected.sampleCount || hash !== v.expected.pcmHash) {
  console.error('mismatch', r.samples.length, hash, v.expected);
  process.exit(1);
}
console.log('consume check ok:', v.id, r.samples.length, 'samples', hash);
`,
  );
  execFileSync(process.execPath, ['check.mjs'], { cwd: work, stdio: 'inherit' });
} finally {
  rmSync(work, { recursive: true, force: true });
}
