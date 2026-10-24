// tsc does not emit the wasm-bindgen JS glue: copy it next to the compiled modules.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
for (const f of ['mumble.js', 'mumble.d.ts']) {
  copyFileSync(join(pkg, 'src', 'generated', f), join(pkg, 'dist', 'generated', f));
}
