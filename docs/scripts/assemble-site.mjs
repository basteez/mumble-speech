// Copies the playground build into the documentation output at /playground/ (L7.2).
import { cpSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const site = join(root, 'docs', '.vitepress', 'dist');
const playground = join(root, 'apps', 'playground', 'dist');

for (const [path, what] of [[site, 'docs'], [playground, 'playground']]) {
  if (!existsSync(path)) throw new Error(`${what} not built: ${path} is missing (run npm run build:site)`);
}
rmSync(join(site, 'playground'), { recursive: true, force: true });
cpSync(playground, join(site, 'playground'), { recursive: true });
// GitHub Pages: serve files as they are, no Jekyll.
writeFileSync(join(site, '.nojekyll'), '');
console.log(`site assembled in ${site}`);
