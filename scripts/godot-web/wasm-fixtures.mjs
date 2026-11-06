// Builds tiny WebAssembly modules for the tests of check-wasm.mjs (scripts/godot-web/check-wasm.test.sh):
// a side module that passes every check, and variants that break exactly one of them.
// Usage as a module: buildModule({ dylink, sharedMemory, atomics, exports, padding }) -> Uint8Array
//        as a script: node wasm-fixtures.mjs <out dir>   writes the fixtures used by check-wasm.test.sh
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const leb = (n) => {
  const out = [];
  do {
    let b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
};
const str = (s) => [...leb(Buffer.byteLength(s)), ...Buffer.from(s)];
const section = (id, content) => [id, ...leb(content.length), ...content];
const custom = (name, content) => section(0, [...str(name), ...content]);

/**
 * @param {object} o
 * @param {boolean} [o.dylink=true]        include the "dylink.0" custom section
 * @param {boolean} [o.sharedMemory=false] import a shared memory (flags: has max, shared)
 * @param {boolean} [o.atomics=false]      the function body has an atomics instruction (atomic.fence)
 * @param {string[]} [o.exports]           exported function names (default: the GDExtension entry symbol)
 * @param {number} [o.padding=0]           bytes of an extra custom section, to reach a size
 */
export function buildModule({ dylink = true, sharedMemory = false, atomics = false, exports = ['gdext_rust_init'], padding = 0 } = {}) {
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  if (dylink) bytes.push(...custom('dylink.0', [0x01, 0x04, 0x00, 0x00, 0x00, 0x00]));
  bytes.push(...section(1, [0x01, 0x60, 0x00, 0x00])); // one type: () -> ()
  const memory = sharedMemory ? [0x03, 0x01, 0x01] : [0x00, 0x01];
  bytes.push(...section(2, [0x01, ...str('env'), ...str('memory'), 0x02, ...memory]));
  bytes.push(...section(3, [0x01, 0x00])); // one function of type 0
  bytes.push(...section(7, [...leb(exports.length), ...exports.flatMap((name) => [...str(name), 0x00, 0x00])]));
  const body = [0x00, ...(atomics ? [0x01, 0xfe, 0x03, 0x00] : [0x01]), 0x0b]; // no locals; nop or atomic.fence; end
  bytes.push(...section(10, [0x01, ...leb(body.length), ...body]));
  if (padding > 0) bytes.push(...custom('pad', new Array(padding).fill(0)));
  return Uint8Array.from(bytes);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: wasm-fixtures.mjs <out dir>');
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  const fixtures = {
    'good.wasm': {},
    'no-dylink.wasm': { dylink: false },
    'shared-memory.wasm': { sharedMemory: true },
    'atomics.wasm': { atomics: true },
    'no-entry.wasm': { exports: ['something_else'] },
    'big.wasm': { padding: 4096 },
  };
  for (const [name, options] of Object.entries(fixtures)) writeFileSync(join(out, name), buildModule(options));
  writeFileSync(join(out, 'not-wasm.wasm'), 'this is not a WebAssembly module');
  writeFileSync(join(out, 'truncated.wasm'), buildModule().subarray(0, 40));
}
