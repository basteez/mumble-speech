// Builds tiny WebAssembly modules for the tests of check-wasm.mjs (scripts/godot-web/check-wasm.test.sh,
// check-wasm.test.mjs): a side module that passes every check, and variants that break exactly one of them.
// Usage as a module: buildModule({ ... }) -> Uint8Array (options below)
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
// Memory limits: flag bit 0 has a maximum, bit 1 shared, bit 2 64-bit (threads and memory64 proposals).
const limits = (flags, min = 1, max = 1) => (flags & 1 ? [flags, min, max] : [flags, min]);

/**
 * @param {object} o
 * @param {boolean} [o.dylink=true]          include the "dylink.0" custom section
 * @param {boolean} [o.sharedMemory=false]   the memory is shared (limits flags 0x03: has max, shared)
 * @param {'import'|'section'|'none'} [o.memory='import']
 *                                           where the memory is: imported from env, declared in the memory section, or absent
 * @param {number} [o.memoryFlags]           overrides the limits flags of the memory (e.g. 0x07: 64-bit shared)
 * @param {boolean} [o.atomics=false]        the first function body has an atomics instruction (atomic.fence)
 * @param {string[]} [o.exports]             exported function names (default: the GDExtension entry symbol)
 * @param {number} [o.padding=0]             bytes of an extra custom section ("pad"), to reach a size
 * @param {number[][]} [o.extraImports]      raw import entries, appended after the memory import
 * @param {Array<{name: string, content: number[]}>} [o.customSections]  extra custom sections
 * @param {Array<{locals?: Array<[number, number|number[]]>, code: number[]}>} [o.functions]
 *                                           function bodies: `code` WITHOUT the final end (0x0b), which is appended.
 *                                           Default: one body with a nop, or with atomic.fence when `atomics`.
 */
export function buildModule({
  dylink = true,
  sharedMemory = false,
  memory = 'import',
  memoryFlags,
  atomics = false,
  exports = ['gdext_rust_init'],
  padding = 0,
  extraImports = [],
  customSections = [],
  functions,
} = {}) {
  const flags = memoryFlags ?? (sharedMemory ? 0x03 : 0x00);
  const bodies = functions ?? [{ code: atomics ? [0x01, 0xfe, 0x03, 0x00] : [0x01] }];
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  if (dylink) bytes.push(...custom('dylink.0', [0x01, 0x04, 0x00, 0x00, 0x00, 0x00]));
  bytes.push(...section(1, [0x01, 0x60, 0x00, 0x00])); // one type: () -> ()
  const imports = [...(memory === 'import' ? [[...str('env'), ...str('memory'), 0x02, ...limits(flags)]] : []), ...extraImports];
  if (imports.length > 0) bytes.push(...section(2, [...leb(imports.length), ...imports.flat()]));
  bytes.push(...section(3, [...leb(bodies.length), ...bodies.map(() => 0x00)])); // every function of type 0
  if (memory === 'section') bytes.push(...section(5, [0x01, ...limits(flags)]));
  bytes.push(...section(7, [...leb(exports.length), ...exports.flatMap((name) => [...str(name), 0x00, 0x00])]));
  const code = bodies.map(({ locals = [], code: instructions }) => {
    const body = [
      ...leb(locals.length),
      ...locals.flatMap(([count, type]) => [...leb(count), ...[type].flat()]),
      ...instructions,
      0x0b,
    ];
    return [...leb(body.length), ...body];
  });
  bytes.push(...section(10, [...leb(bodies.length), ...code.flat()]));
  for (const { name, content } of customSections) bytes.push(...custom(name, content));
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
