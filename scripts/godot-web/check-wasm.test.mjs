// Tests of check-wasm.mjs (specs/tasks.md W1, specs/requirements.md L4.17, LD27, LD34): the container
// reader, the instruction decoder on every class of instruction, the .gdextension reader, the budget
// and the command line. The bytes come from wasm-fixtures.mjs; no Emscripten, Rust or Godot needed.
// Run: node --test scripts/godot-web/check-wasm.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkGdextension,
  checkModeName,
  checkWasm,
  DEFAULT_ENTRY_SYMBOL,
  parseWasm,
  simdImmediates,
  readBudget,
  readEntrySymbol,
  readLibraries,
  readThreadsBudget,
  WEB_KEYS,
  WEB_LIBRARY_PATH,
  WEB_THREADS_KEYS,
} from './check-wasm.mjs';
import { buildModule } from './wasm-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const script = join(here, 'check-wasm.mjs');
const repoGdextension = join(root, 'bindings', 'godot', 'addons', 'mumble_speech', 'mumble_speech.gdextension');
const repoVersions = join(here, 'versions.env');
const repoGdextensionText = readFileSync(repoGdextension, 'utf8');
const crlf = (text) => text.replace(/\n/g, '\r\n');

// atomic.fence: the atomics instruction the checks must find (prefix 0xFE, then the sub-opcode 0x03 and a memory index).
const FENCE = [0xfe, 0x03, 0x00];

// A module whose only function body is `code` (without its final end).
const moduleWith = (code, options = {}) => buildModule({ functions: [{ code }], ...options });

// The decoder must step over the immediates of `code`: an atomic placed after it is found at its own
// offset (the file ends with fence, end), and without it nothing is taken for an atomic.
function expectFence(code, label) {
  const module = moduleWith([...code, ...FENCE]);
  const parsed = parseWasm(module);
  assert.equal(parsed.error, undefined, `${label}: ${parsed.error}`);
  assert.equal(parsed.atomicsAt, module.length - 4, `${label}: the atomic after it was not found at its offset`);
}
function expectNoFence(code, label) {
  const parsed = parseWasm(moduleWith(code));
  assert.equal(parsed.error, undefined, `${label}: ${parsed.error}`);
  assert.equal(parsed.atomicsAt, -1, `${label}: an immediate was taken for an atomics instruction`);
}
function expectClass(ops) {
  for (const [label, code] of ops) {
    expectFence(code, label);
    expectNoFence(code, label);
  }
}

// --- The container (L4.17) ----------------------------------------------------------------------

test('a side module without threads passes every check (L4.17)', () => {
  const bytes = buildModule();
  const parsed = parseWasm(bytes);
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.dylink, true);
  assert.deepEqual(parsed.imports, [{ module: 'env', name: 'memory', shared: false }]);
  assert.deepEqual(parsed.memories, []);
  assert.deepEqual(parsed.exports, ['gdext_rust_init']);
  assert.equal(parsed.atomicsAt, -1);
  assert.deepEqual(checkWasm(bytes, { budget: bytes.length }).errors, []);
});

test('bad magic is rejected, including inputs shorter than the header', () => {
  const bytes = buildModule();
  bytes[0] = 0x01;
  assert.match(parseWasm(bytes).error, /bad magic/);
  assert.match(parseWasm(Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00)).error, /bad magic/);
  assert.match(parseWasm(new Uint8Array(0)).error, /bad magic/);
  assert.match(parseWasm(new TextEncoder().encode('this is not a WebAssembly module')).error, /bad magic/);
});

test('only WebAssembly version 1 is accepted', () => {
  const bytes = buildModule();
  bytes[4] = 2;
  assert.match(parseWasm(bytes).error, /unsupported WebAssembly version 0x00000002\b/);
  const reserved = buildModule();
  reserved[7] = 1; // version word 0x01000001: not version 1
  assert.match(parseWasm(reserved).error, /unsupported WebAssembly version 0x01000001\b/); // the whole word, not byte 4
});

test('truncation is reported as malformed, never thrown (L4.17: a broken file fails)', () => {
  // Cut inside the size of the first section (the id is there, the size is not).
  assert.match(parseWasm(buildModule().subarray(0, 9)).error, /malformed.*truncated/);
  // A section size whose LEB128 continuation bit is set at the end of the file.
  assert.match(parseWasm(Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x80)).error, /malformed.*truncated/);
  // Cuts inside the last section (a padding custom section) are a section that runs past the end.
  const padded = buildModule({ padding: 64 });
  for (let n = padded.length - 60; n < padded.length; n++) {
    assert.match(parseWasm(padded.subarray(0, n)).error, /runs past the end/, `cut at ${n}`);
  }
  // Every prefix of a valid module is parsed or rejected; none throws.
  const bytes = buildModule();
  for (let n = 0; n < bytes.length; n++) parseWasm(bytes.subarray(0, n));
});

test('a LEB128 longer than ten bytes is malformed', () => {
  const bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, ...new Array(10).fill(0x80)];
  assert.match(parseWasm(Uint8Array.from(bytes)).error, /LEB128 too long/);
});

test('a section that runs past the end of the file is malformed', () => {
  const bytes = Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x20, 0x00);
  assert.match(parseWasm(bytes).error, /section 1 runs past the end of the file/);
});

test('a custom section without a name is malformed', () => {
  const bytes = Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00);
  assert.match(parseWasm(bytes).error, /malformed/);
});

test('a function body that runs past the code section is malformed', () => {
  // The body size of the only function is larger than the section.
  // The code section is last: id, size, count, body size, locals, nop, end. The body size is the fourth byte from the end.
  const bytes = buildModule();
  const forged = Uint8Array.from(bytes);
  forged[bytes.length - 4] = 0x7f;
  assert.match(parseWasm(forged).error, /function body runs past the code section/);
});

test('the dylink.0 section is required: the older name "dylink" is not accepted (L4.17)', () => {
  const legacy = buildModule({ dylink: false, customSections: [{ name: 'dylink', content: [0x01, 0x04, 0x00, 0x00, 0x00, 0x00] }] });
  const errors = checkWasm(legacy).errors;
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no "dylink\.0" section/);
});

// --- Memory (L4.17: no shared memory, imported or declared) -------------------------------------

test('shared memory imported from env is reported (L4.17)', () => {
  const bytes = buildModule({ sharedMemory: true });
  assert.equal(parseWasm(bytes).imports[0].shared, true);
  assert.match(checkWasm(bytes).errors.join('\n'), /shared memory/);
});

test('shared memory declared in the memory section (not imported) is reported (L4.17)', () => {
  const bytes = buildModule({ sharedMemory: true, memory: 'section' });
  const parsed = parseWasm(bytes);
  assert.deepEqual(parsed.imports, []);
  assert.deepEqual(parsed.memories, [{ shared: true }]);
  assert.match(checkWasm(bytes).errors.join('\n'), /shared memory/);
});

test('non-shared memory declared in the memory section passes', () => {
  const bytes = buildModule({ memory: 'section' });
  assert.deepEqual(parseWasm(bytes).memories, [{ shared: false }]);
  assert.deepEqual(checkWasm(bytes).errors, []);
});

test('a module without any memory passes the memory check', () => {
  assert.deepEqual(checkWasm(buildModule({ memory: 'none' })).errors, []);
});

test('64-bit limits: shared is bit 1; memory64 alone is not a threads property (L4.17 checks shared memory only)', () => {
  // flags 0x05: has a maximum and is 64-bit, not shared.
  assert.deepEqual(parseWasm(buildModule({ memory: 'section', memoryFlags: 0x05 })).memories, [{ shared: false }]);
  assert.deepEqual(checkWasm(buildModule({ memory: 'section', memoryFlags: 0x05 })).errors, []);
  // flags 0x07: 64-bit and shared.
  assert.deepEqual(parseWasm(buildModule({ memory: 'section', memoryFlags: 0x07 })).memories, [{ shared: true }]);
  assert.match(checkWasm(buildModule({ memory: 'section', memoryFlags: 0x07 })).errors.join('\n'), /shared memory/);
});

test('shared memory is found after table, global, function and tag imports (kinds 0, 1, 3, 4)', () => {
  const extraImports = [
    [...[0x03, 0x65, 0x6e, 0x76], ...[0x01, 0x66], 0x00, 0x00], // env.f: function, type 0
    [0x03, 0x65, 0x6e, 0x76, 0x01, 0x74, 0x01, 0x70, 0x00, 0x01], // env.t: table, funcref, min 1
    [0x03, 0x65, 0x6e, 0x76, 0x01, 0x67, 0x03, 0x7f, 0x01], // env.g: global, i32 mutable
    [0x03, 0x65, 0x6e, 0x76, 0x03, 0x74, 0x61, 0x67, 0x04, 0x00, 0x00], // env.tag: tag, attribute 0, type 0
    [0x03, 0x65, 0x6e, 0x76, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x03, 0x01, 0x01], // env.memory: shared
  ];
  const bytes = buildModule({ memory: 'none', extraImports });
  const parsed = parseWasm(bytes);
  assert.equal(parsed.error, undefined, parsed.error);
  assert.deepEqual(parsed.imports, [{ module: 'env', name: 'memory', shared: true }]);
  assert.match(checkWasm(bytes).errors.join('\n'), /shared memory/);
});

test('a reference-typed global import does not hide the shared memory imported after it', () => {
  // global (ref null func) mutable: the value type is two bytes (0x63 0x70).
  const extraImports = [
    [0x03, 0x65, 0x6e, 0x76, 0x01, 0x67, 0x03, 0x63, 0x70, 0x01],
    [0x03, 0x65, 0x6e, 0x76, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x03, 0x01, 0x01],
  ];
  const bytes = buildModule({ memory: 'none', extraImports });
  const parsed = parseWasm(bytes);
  assert.equal(parsed.error, undefined, parsed.error);
  assert.deepEqual(parsed.imports, [{ module: 'env', name: 'memory', shared: true }]);
});

// --- Entry symbol and the budget (L4.17, LD34) --------------------------------------------------

test('the entry symbol is gdext_rust_init and is matched exactly', () => {
  assert.equal(DEFAULT_ENTRY_SYMBOL, 'gdext_rust_init');
  assert.deepEqual(checkWasm(buildModule({ exports: ['gdext_rust_init', 'other'] })).errors, []);
  assert.match(checkWasm(buildModule({ exports: ['gdext_rust_init_v2'] })).errors.join('\n'), /entry symbol "gdext_rust_init" is not exported/);
  assert.match(checkWasm(buildModule({ exports: ['gdext_rust'] })).errors.join('\n'), /not exported/);
  assert.deepEqual(checkWasm(buildModule({ exports: ['other'] }), { entrySymbol: 'other' }).errors, []);
});

test('the budget is inclusive: a size equal to the budget passes, one byte more fails (LD34)', () => {
  const bytes = buildModule({ padding: 100 });
  assert.deepEqual(checkWasm(bytes, { budget: bytes.length }).errors, []);
  const over = checkWasm(bytes, { budget: bytes.length - 1 }).errors;
  assert.deepEqual(over, [`size ${bytes.length} bytes exceeds the budget of ${bytes.length - 1} bytes (LD34)`]);
});

test('without a budget there is no size check', () => {
  assert.deepEqual(checkWasm(buildModule({ padding: 20000 })).errors, []);
});

test('the info carries the raw and gzip sizes, and gzip is smaller for repetitive bytes', () => {
  const bytes = buildModule({ padding: 10000 });
  const { info } = checkWasm(bytes);
  assert.equal(info.rawBytes, bytes.length);
  assert.ok(info.gzipBytes > 0 && info.gzipBytes < info.rawBytes, `gzip ${info.gzipBytes}, raw ${info.rawBytes}`);
});

test('a malformed file reports its parse error, and still its raw size', () => {
  const { errors, info } = checkWasm(Uint8Array.of(1, 2, 3), { budget: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /bad magic/);
  assert.equal(info.rawBytes, 3);
});

// --- Instruction decoder (L4.17: a function with atomics is a threaded build) --------------------

test('ordinary MVP code has no atomics', () => {
  const code = [0x23, 0x00, 0x20, 0x00, 0x41, 0x2a, 0x6a, 0x21, 0x00, 0x1a];
  assert.deepEqual(checkWasm(moduleWith(code)).errors, []);
});

test('control instructions: each is stepped over with its immediates (MVP, exception handling)', () => {
  expectClass([
    ['unreachable', [0x00]],
    ['nop', [0x01]],
    ['block (empty type)', [0x02, 0x40, 0x0b]],
    ['loop (type index 0)', [0x03, 0x00, 0x0b]],
    ['if and else (empty type)', [0x41, 0x00, 0x04, 0x40, 0x05, 0x0b]],
    ['legacy try, catch and catch_all', [0x06, 0x40, 0x07, 0x00, 0x19, 0x0b]],
    ['legacy delegate', [0x06, 0x40, 0x18, 0x00]],
    ['br 0', [0x0c, 0x00]],
    ['br_if 0', [0x0d, 0x00]],
    ['br_table with two labels and a default', [0x0e, 0x02, 0x00, 0x01, 0x00]],
    ['br_table with no labels', [0x0e, 0x00, 0x00]],
    ['return', [0x0f]],
    ['call 0', [0x10, 0x00]],
    ['call_indirect (type 0, table 0)', [0x11, 0x00, 0x00]],
    ['return_call 0', [0x12, 0x00]],
    ['return_call_indirect (type 0, table 0)', [0x13, 0x00, 0x00]],
    ['call_ref 0', [0x14, 0x00]],
    ['return_call_ref 0', [0x15, 0x00]],
    ['try_table with a catch and a catch_all', [0x1f, 0x40, 0x02, 0x00, 0x00, 0x00, 0x02, 0x00]],
    ['throw 0', [0x08, 0x00]],
    ['rethrow 0', [0x09, 0x00]],
    ['throw_ref', [0x0a]],
    ['br_on_null 0', [0xd5, 0x00]],
    ['br_on_non_null 0', [0xd6, 0x00]],
  ]);
});

test('parametric and variable instructions, including typed select', () => {
  expectClass([
    ['drop', [0x1a]],
    ['select', [0x1b]],
    ['typed select (i32)', [0x1c, 0x01, 0x7f]],
    ['typed select (two i64)', [0x1c, 0x02, 0x7e, 0x7e]],
    ['typed select (reference, two-byte type)', [0x1c, 0x01, 0x63, 0x70]],
    ['local.get 0', [0x20, 0x00]],
    ['local.set 0', [0x21, 0x00]],
    ['local.tee 0', [0x22, 0x00]],
    ['global.get 0', [0x23, 0x00]],
    ['global.set 0', [0x24, 0x00]],
    ['table.get 0', [0x25, 0x00]],
    ['table.set 0', [0x26, 0x00]],
  ]);
});

test('memory instructions: loads, stores, memarg with an offset of two bytes, memory.size and grow', () => {
  expectClass([
    ['i32.load align 4', [0x28, 0x02, 0x00]],
    ['f64.load with offset 300 (two-byte LEB128)', [0x2b, 0x03, 0xac, 0x02]],
    ['i64.store8', [0x3c, 0x00, 0x00]],
    ['i32.store16 with an offset whose LEB128 contains 0xFE', [0x3b, 0x01, 0xfe, 0x01]],
    ['memarg with the multi-memory bit (memory index 0)', [0x28, 0x42, 0x00, 0x00]],
    ['memory.size', [0x3f, 0x00]],
    ['memory.grow', [0x40, 0x00]],
  ]);
});

test('constants: immediates that contain 0xFE are not atomics', () => {
  expectClass([
    ['i32.const 0', [0x41, 0x00]],
    ['i32.const -1', [0x41, 0x7f]],
    ['i32.const -2 (LEB128 with 0xFE)', [0x41, 0xfe, 0x7f]],
    ['i64.const with 0xFE bytes', [0x42, 0xfe, 0xfe, 0x7f]],
    ['f32.const with 0xFE bytes', [0x43, 0xfe, 0xfe, 0xfe, 0xfe]],
    ['f64.const with 0xFE bytes', [0x44, ...new Array(8).fill(0xfe)]],
  ]);
});

test('numeric and reference instructions', () => {
  expectClass([
    ['i32.add', [0x6a]],
    ['f64.copysign', [0xa6]],
    ['i32.extend8_s', [0xc0]],
    ['i64.extend32_s', [0xc4]],
    ['ref.null func', [0xd0, 0x70]],
    ['ref.null extern', [0xd0, 0x6f]],
    ['ref.func 0', [0xd2, 0x00]],
    ['ref.is_null', [0xd1]],
    ['ref.eq', [0xd3]],
    ['ref.as_non_null', [0xd4]],
  ]);
});

test('0xFC prefix: saturating truncation and the bulk-memory and table instructions', () => {
  const misc = [];
  for (let sub = 0; sub <= 7; sub++) misc.push([`0xfc ${sub} (saturating truncation)`, [0xfc, sub]]);
  misc.push(
    ['memory.init 0 0', [0xfc, 0x08, 0x00, 0x00]],
    ['data.drop 0', [0xfc, 0x09, 0x00]],
    ['memory.copy', [0xfc, 0x0a, 0x00, 0x00]],
    ['memory.fill', [0xfc, 0x0b, 0x00]],
    ['table.init 0 0', [0xfc, 0x0c, 0x00, 0x00]],
    ['elem.drop 0', [0xfc, 0x0d, 0x00]],
    ['table.copy 0 0', [0xfc, 0x0e, 0x00, 0x00]],
    ['table.grow 0', [0xfc, 0x0f, 0x00]],
    ['table.size 0', [0xfc, 0x10, 0x00]],
    ['table.fill 0', [0xfc, 0x11, 0x00]],
  );
  expectClass(misc);
});

test('0xFD prefix (SIMD): memarg, lane and 16-byte immediates, including immediates that look like 0xFE', () => {
  expectClass([
    ['v128.load align 4', [0xfd, 0x00, 0x04, 0x00]],
    ['v128.load8x8_s', [0xfd, 0x01, 0x03, 0x10]],
    ['v128.store', [0xfd, 0x0b, 0x04, 0x00]],
    ['v128.load32_zero', [0xfd, 0x5c, 0x02, 0x00]],
    ['v128.load64_zero', [0xfd, 0x5d, 0x03, 0x00]],
    ['v128.load8_lane, lane 3', [0xfd, 0x54, 0x00, 0x00, 0x03]],
    ['v128.store64_lane, lane 1', [0xfd, 0x5b, 0x03, 0x00, 0x01]],
    ['v128.const whose 16 bytes include 0xFE', [0xfd, 0x0c, 0xfe, 0x00, ...new Array(14).fill(0xfe)]],
    ['i8x16.shuffle whose lanes include 0xFE', [0xfd, 0x0d, ...new Array(16).fill(0xfe)]],
    ['i8x16.extract_lane_s, lane 3', [0xfd, 0x15, 0x03]],
    ['f64x2.replace_lane, lane 1', [0xfd, 0x22, 0x01]],
    ['i8x16.swizzle', [0xfd, 0x0e]],
    ['i32x4.splat', [0xfd, 0x11]],
    ['f32x4.demote_f64x2_zero', [0xfd, 0x5e]],
    ['i8x16.popcnt', [0xfd, 0x62]],
    ['relaxed SIMD (sub-opcode 0x100, LEB128)', [0xfd, 0x80, 0x02]],
  ]);
});

// The table of the 0xFD sub-opcodes is checked against the spec's instruction index: 256 assigned
// codes (0x00-0xFF without 20 reserved ones, plus relaxed SIMD 0x100-0x113).
const SIMD_RESERVED = [0x9a, 0xa2, 0xa5, 0xa6, 0xaf, 0xb0, 0xb2, 0xb3, 0xb4, 0xbb, 0xc2, 0xc5, 0xc6, 0xcf, 0xd0,
  0xd2, 0xd3, 0xd4, 0xe2, 0xee];
const leb = (n) => {
  const out = [];
  do {
    out.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0));
    n >>= 7;
  } while (n > 0);
  return out;
};
const IMMEDIATE_BYTES = {
  none: [], memarg: [0x03, 0xfe, 0x01], 'memarg+lane': [0x03, 0xfe, 0x01, 0xfe], lane: [0xfe],
  v128: new Array(16).fill(0xfe), shuffle: new Array(16).fill(0xfe),
};

test('every assigned 0xFD sub-opcode passes with its own immediates, every other one fails (L4.17)', () => {
  let assigned = 0;
  for (let sub = 0; sub <= 0x113; sub++) {
    const kind = simdImmediates(sub);
    const label = `0xfd sub-opcode 0x${sub.toString(16)}`;
    if (SIMD_RESERVED.includes(sub)) {
      assert.equal(kind, undefined, `${label} is reserved`);
      continue;
    }
    assert.ok(kind, `${label} is assigned`);
    assigned++;
    // The immediates carry 0xFE bytes: a decoder that mis-sizes them would report atomics.
    expectClass([[`${label} (${kind})`, [0xfd, ...leb(sub), ...IMMEDIATE_BYTES[kind]]]]);
  }
  assert.equal(assigned, 256);
});

test('the immediate layouts of the 0xFD sub-opcodes follow the spec', () => {
  const expected = {
    memarg: [0x00, 0x01, 0x06, 0x07, 0x0a, 0x0b, 0x5c, 0x5d],
    'memarg+lane': [0x54, 0x57, 0x58, 0x5b],
    lane: [0x15, 0x1b, 0x22],
    v128: [0x0c],
    shuffle: [0x0d],
    none: [0x0e, 0x14, 0x23, 0x53, 0x5e, 0x62, 0x99, 0x9b, 0xff, 0x100, 0x113],
  };
  for (const [kind, subs] of Object.entries(expected)) {
    for (const sub of subs) assert.equal(simdImmediates(sub), kind, `0x${sub.toString(16)}`);
  }
});

test('an unassigned 0xFD sub-opcode fails, naming the sub-opcode and the offset (fail closed, L4.17)', () => {
  for (const sub of [0x9a, 0xa2, 0xee, 0x114, 0x115, 0x200, 0x3fff]) {
    const { errors } = checkWasm(moduleWith([0x01, 0xfd, ...leb(sub), ...FENCE]));
    assert.equal(errors.length, 1, `0x${sub.toString(16)}`);
    assert.match(errors[0], new RegExp(`malformed WebAssembly binary: unknown instruction 0xfd sub-opcode 0x${sub.toString(16)} at offset \\d+`));
  }
});

test('atomics after a SIMD instruction whose immediates contain 0xFE is still found', () => {
  const { errors } = checkWasm(moduleWith([0xfd, 0x0d, ...new Array(16).fill(0xfe), ...FENCE]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /atomics/);
});

test('an unknown opcode fails the check; it is not passed over (L4.17)', () => {
  for (const [label, code] of [
    ['0x1d (unassigned)', [0x1d]],
    ['0xc5 (unassigned, after the numeric range)', [0xc5]],
    ['0xd7 (unassigned)', [0xd7]],
    ['0xfb (GC prefix, not decoded)', [0xfb, 0x00]],
    ['0xfc 18 (unknown misc sub-opcode)', [0xfc, 0x12]],
  ]) {
    const { errors } = checkWasm(moduleWith([...code, ...FENCE]));
    assert.equal(errors.length, 1, label);
    assert.match(errors[0], /malformed WebAssembly binary: unknown instruction/, label);
  }
});

test('atomics present must fail, with the offset of the instruction', () => {
  const module = moduleWith([0x01, ...FENCE]);
  const errors = checkWasm(module).errors;
  assert.equal(errors.length, 1);
  assert.equal(errors[0], `atomics instruction at offset ${module.length - 4}: this is a threaded build (L4.17: no threads)`);
});

test('atomics in a later function are found: every body is walked until one has them', () => {
  const module = buildModule({ functions: [{ code: [0x01] }, { code: [0x01, 0x41, 0x00, ...FENCE] }] });
  assert.equal(parseWasm(module).atomicsAt, module.length - 4);
  assert.match(checkWasm(module).errors.join('\n'), /atomics instruction/);
});

test('an immediate that runs past its function body is malformed', () => {
  // f32.const needs four bytes; the body has two. The next function's bytes are read by mistake.
  const module = buildModule({ functions: [{ code: [0x43, 0x00] }, { code: [0x01] }] });
  assert.match(parseWasm(module).error, /function body overruns its size/);
});

test('locals of a reference type are read as two bytes (0xFE in the heap type is not an atomic)', () => {
  // A local (ref null $t) with type index 254 (0xFE 0x01), then nothing that is atomic.
  const module = buildModule({ functions: [{ locals: [[1, [0x63, 0xfe, 0x01]]], code: [0x01] }] });
  const parsed = parseWasm(module);
  assert.equal(parsed.error, undefined, parsed.error);
  assert.equal(parsed.atomicsAt, -1);
});

// --- .gdextension (L4.17, LD27) ------------------------------------------------------------------

test('readEntrySymbol reads the repository file, in LF and CRLF, and ignores comments', () => {
  assert.equal(readEntrySymbol(repoGdextensionText), 'gdext_rust_init');
  assert.equal(readEntrySymbol(crlf(repoGdextensionText)), 'gdext_rust_init');
  assert.equal(readEntrySymbol('[configuration]\n  entry_symbol = "indented"\n'), 'indented');
  assert.equal(readEntrySymbol('[configuration]\n# entry_symbol = "commented"\n'), undefined);
  assert.equal(readEntrySymbol('[configuration]\n'), undefined);
  assert.equal(readEntrySymbol('entry_symbol = ""\n'), '');
});

test('readLibraries returns the ten [libraries] entries of the repository file', () => {
  const libraries = readLibraries(repoGdextensionText);
  assert.deepEqual(Object.keys(libraries).sort(), [
    'linux.debug.x86_64', 'linux.release.x86_64', 'macos.debug', 'macos.release',
    'web.debug.threads.wasm32', 'web.debug.wasm32', 'web.release.threads.wasm32', 'web.release.wasm32',
    'windows.debug.x86_64', 'windows.release.x86_64',
  ]);
  assert.equal(libraries['web.release.wasm32'], WEB_LIBRARY_PATH);
});

test('readLibraries: CRLF, comment lines and comment-only values are handled; keys outside [libraries] are ignored', () => {
  const text = [
    '; a comment',
    '# another comment',
    '[configuration]',
    'web.debug.wasm32 = "res://outside.wasm"',
    '',
    '[libraries]',
    '# web.release.wasm32 = "commented.wasm"',
    'web.debug.wasm32 = "res://a.wasm"',
    'linux.release.x86_64 = "res://b.so"',
    'unquoted = res://c.so',
    '[other]',
    'web.release.wasm32 = "res://after-other.wasm"',
  ].join('\r\n');
  assert.deepEqual(readLibraries(text), { 'web.debug.wasm32': 'res://a.wasm', 'linux.release.x86_64': 'res://b.so' });
});

test('checkGdextension passes the repository file in LF and CRLF', () => {
  assert.deepEqual(checkGdextension(repoGdextensionText), []);
  assert.deepEqual(checkGdextension(crlf(repoGdextensionText)), []);
});

test('checkGdextension: missing web keys, a key outside [libraries], a wrong path and a threaded key all fail', () => {
  const noWeb = repoGdextensionText.split('\n').filter((l) => !l.startsWith('web.')).join('\n');
  assert.deepEqual(checkGdextension(noWeb), [
    'web.debug.wasm32 is missing from [libraries]',
    'web.release.wasm32 is missing from [libraries]',
    'web.debug.threads.wasm32 is missing from [libraries]',
    'web.release.threads.wasm32 is missing from [libraries]',
  ]);
  // Under [configuration] the web keys are not libraries.
  const underConfiguration = repoGdextensionText.replace('[libraries]', '[configuration]');
  assert.equal(checkGdextension(underConfiguration).length, 4);
  const wrongPath = repoGdextensionText.replace(
    'web.release.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.wasm"',
    'web.release.wasm32 = "res://addons/mumble_speech/bin/other.wasm"',
  );
  assert.deepEqual(checkGdextension(wrongPath), [
    `web.release.wasm32 is "res://addons/mumble_speech/bin/other.wasm", expected "${WEB_LIBRARY_PATH}"`,
  ]);
  // An extra web key is rejected (the four-key rule of LD38 replaced the rejection of any threads key).
  assert.match(checkGdextension(`${repoGdextensionText}\nweb.release.nothreads.wasm32 = "x"\n`).join('\n'), /not one of the four web keys/);
});

test('checkGdextension: a web key placed under another section does not count', () => {
  const text = '[configuration]\nweb.debug.wasm32 = "' + WEB_LIBRARY_PATH + '"\nweb.release.wasm32 = "' + WEB_LIBRARY_PATH + '"\n';
  assert.deepEqual(checkGdextension(text), [
    'web.debug.wasm32 is missing from [libraries]',
    'web.release.wasm32 is missing from [libraries]',
    'web.debug.threads.wasm32 is missing from [libraries]',
    'web.release.threads.wasm32 is missing from [libraries]',
  ]);
});

test('checkGdextension: a file without the [libraries] header lists every web key as missing', () => {
  assert.equal(checkGdextension('entry_symbol = "gdext_rust_init"\n').length, 4);
});

// --- Budget (versions.env) ------------------------------------------------------------------------

test('readBudget reads WASM_BUDGET_BYTES from versions.env (LF and CRLF) and nothing else', () => {
  const budget = readBudget(readFileSync(repoVersions, 'utf8'));
  assert.ok(Number.isInteger(budget) && budget > 0, `budget ${budget}`);
  assert.equal(readBudget('RUST_NIGHTLY=x\nWASM_BUDGET_BYTES=1000\n'), 1000);
  assert.equal(readBudget('WASM_BUDGET_BYTES=1000\r\n'), 1000);
  assert.equal(readBudget('# WASM_BUDGET_BYTES=1000\n'), undefined);
  assert.equal(readBudget('RUST_NIGHTLY=x\n'), undefined);
  assert.equal(readBudget('WASM_BUDGET_BYTES=12M\n'), undefined);
});

// --- Command line ---------------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), 'check-wasm-test-'));
after(() => rmSync(work, { recursive: true, force: true }));
const fixture = (name, options) => {
  const path = join(work, name);
  writeFileSync(path, buildModule(options));
  return path;
};
const good = fixture('good.wasm', {});
const big = fixture('big.wasm', { padding: 4096 });
const run = (args) => {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: result.status, out: result.stdout, err: result.stderr };
};

test('the command line: no arguments, extra arguments and bad options are usage errors (exit 2)', () => {
  assert.equal(run([]).status, 2);
  assert.match(run([]).err, /usage:/);
  assert.equal(run([good, good]).status, 2);
  assert.equal(run([good, '--nope']).status, 2);
  assert.equal(run([good, '--budget']).status, 2);
  assert.equal(run([good, '--gdextension']).status, 2);
  for (const value of ['1.5', '-1', 'abc', '']) {
    assert.equal(run([good, '--budget', value]).status, 2, `--budget "${value}"`);
  }
});

test('the command line: a passing module exits 0 and prints its raw and gzip sizes and the budget', () => {
  const result = run([good, '--budget', '100000']);
  assert.equal(result.status, 0, result.err);
  assert.match(result.out, /raw \d+ bytes .* gzip \d+ bytes .*budget 100000 bytes/);
  assert.match(result.out, /check-wasm: ok/);
});

test('the command line: without --budget the budget is WASM_BUDGET_BYTES of versions.env', () => {
  const expected = readBudget(readFileSync(repoVersions, 'utf8'));
  const result = run([good]);
  assert.equal(result.status, 0, result.err);
  assert.match(result.out, new RegExp(`budget ${expected} bytes`));
});

test('the command line: budget 0 fails, and a module over the budget exits 1 and names the file', () => {
  assert.equal(run([good, '--budget', '0']).status, 1);
  const over = run([big, '--budget', '1000']);
  assert.equal(over.status, 1);
  assert.match(over.err, new RegExp(`FAIL ${big.replaceAll('.', '\\.')}: size .* exceeds the budget`));
});

test('the command line runs when invoked through a symlink (a silent pass would hide a failed check)', () => {
  // mktemp folders are often symlinks (macOS /var -> /private/var): the entry point must still run.
  const link = join(work, 'link-to-check-wasm.mjs');
  symlinkSync(script, link);
  const result = spawnSync(process.execPath, [link, good, '--budget', '100000'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /check-wasm: ok/);
  const failing = spawnSync(process.execPath, [link, big, '--budget', '1000'], { encoding: 'utf8' });
  assert.equal(failing.status, 1, 'a failing module must exit 1 through a symlink');
  assert.equal(spawnSync(process.execPath, [link], { encoding: 'utf8' }).status, 2);
});

test('the command line: a missing file exits 1 with the reason', () => {
  const result = run([join(work, 'absent.wasm'), '--budget', '1000']);
  assert.equal(result.status, 1);
  assert.match(result.err, /cannot read: ENOENT/);
});

test('the command line: the .gdextension alone is checked, and the repository file passes', () => {
  assert.equal(run(['--gdextension', repoGdextension]).status, 0);
  const noWeb = join(work, 'no-web.gdextension');
  writeFileSync(noWeb, repoGdextensionText.split('\n').filter((l) => !l.startsWith('web.debug')).join('\n'));
  const result = run(['--gdextension', noWeb]);
  assert.equal(result.status, 1);
  assert.match(result.err, /web\.debug\.wasm32 is missing from \[libraries\]/);
});

test('the command line: a versions.env without a budget fails instead of disabling the size check (L4.17)', () => {
  // check-wasm.mjs reads versions.env from its own folder: a copy with no budget (or a malformed one).
  const folder = mkdtempSync(join(work, 'copy-'));
  copyFileSync(script, join(folder, 'check-wasm.mjs'));
  for (const [name, content] of [['none', 'RUST_NIGHTLY=nightly\n'], ['malformed', 'WASM_BUDGET_BYTES=12M\n']]) {
    writeFileSync(join(folder, 'versions.env'), content);
    const result = spawnSync(process.execPath, [join(folder, 'check-wasm.mjs'), good], { encoding: 'utf8' });
    assert.equal(result.status, 1, `${name}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /WASM_BUDGET_BYTES/, name);
  }
});

// --- Threaded library (L4.20, LD38): --threads, the atomics count, the budget and the .gdextension -----
// Test phase of issue #34 (tasks T1-T5). Every case below names the requirement it covers.

const THREADED_NAME = 'mumble_godot.threads.wasm';
const NOTIFY = [0xfe, 0x00, 0x02, 0x00]; // memory.atomic.notify, align 2, offset 0

test('the threaded side module passes every --threads check, with its atomics count (L4.20)', () => {
  const bytes = buildModule({ sharedMemory: true, atomics: true });
  const parsed = parseWasm(bytes, { countAtomics: true });
  assert.equal(parsed.error, undefined, parsed.error);
  assert.deepEqual(parsed.imports, [{ module: 'env', name: 'memory', shared: true }]);
  assert.deepEqual(parsed.memories, []);
  assert.equal(parsed.atomicsCount, 1);
  const result = checkWasm(bytes, { threads: true, budget: bytes.length, fileName: THREADED_NAME });
  assert.deepEqual(result.errors, []);
  assert.equal(result.info.atomicsCount, 1);
});

test('a non-threaded module checked with --threads fails on both the shared memory and the atomics (L4.20)', () => {
  const errors = checkWasm(buildModule(), { threads: true }).errors;
  assert.deepEqual(errors, [
    'no shared memory import: the imported memory is not shared, this is not a threaded build (L4.20)',
    'no atomics instruction: this is not a threaded build (L4.20)',
  ]);
});

test('a threaded module checked without --threads fails on the shared memory and the atomics (L4.17)', () => {
  const bytes = buildModule({ sharedMemory: true, atomics: true });
  const errors = checkWasm(bytes).errors;
  assert.equal(errors.length, 2, errors.join('\n'));
  assert.match(errors[0], /shared memory: this is a threaded build \(L4\.17: no threads\)/);
  assert.match(errors[1], /atomics instruction at offset \d+: this is a threaded build/);
});

test('file name and mode must agree in both directions, and the name rule is exact (LD38)', () => {
  const plain = buildModule();
  const threaded = buildModule({ sharedMemory: true, atomics: true });
  assert.equal(checkModeName('mumble_godot.wasm', false), undefined);
  assert.equal(checkModeName(THREADED_NAME, true), undefined);
  assert.match(checkModeName(THREADED_NAME, false), /check it with --threads \(LD38\)/);
  assert.match(checkModeName('mumble_godot.wasm', true), /not a threaded library name \(\*\.threads\.wasm\)/);
  // A threaded module under the plain name: the name and the mode agree (both plain), so only the content fails it.
  const swapped = checkWasm(threaded, { fileName: 'mumble_godot.wasm' }).errors;
  assert.ok(!swapped.some((e) => /check it with --threads|not a threaded library name/.test(e)), swapped.join('\n'));
  assert.ok(swapped.some((e) => /shared memory: this is a threaded build/.test(e)));
  // The plain module under the threaded name, checked with --threads: the name agrees, the content fails both checks.
  const swappedBack = checkWasm(plain, { threads: true, fileName: THREADED_NAME }).errors;
  assert.equal(swappedBack.length, 2, swappedBack.join('\n'));
  assert.ok(swappedBack.some((e) => /no shared memory import/.test(e)));
  assert.ok(swappedBack.some((e) => /no atomics instruction/.test(e)));
  // The plain module under the threaded name, checked without --threads: the name is the failure (LD38).
  assert.match(checkWasm(plain, { fileName: THREADED_NAME }).errors[0], /check it with --threads/);
  // Names that only look like the threaded one do not count as it.
  assert.equal(checkModeName('mumble_godot.threads.wasm.bak', false), undefined);
  assert.match(checkModeName('x.threads.wasm', false), /check it with --threads/);
});

test('shared memory without atomics fails with --threads, naming the missing atomics (L4.20)', () => {
  const errors = checkWasm(buildModule({ sharedMemory: true }), { threads: true }).errors;
  assert.deepEqual(errors, ['no atomics instruction: this is not a threaded build (L4.20)']);
});

test('atomics without a shared memory import fail with --threads (L4.20)', () => {
  const errors = checkWasm(buildModule({ atomics: true }), { threads: true }).errors;
  assert.deepEqual(errors, ['no shared memory import: the imported memory is not shared, this is not a threaded build (L4.20)']);
});

test('a shared memory defined by the module, not imported, fails with --threads (L4.20)', () => {
  const errors = checkWasm(buildModule({ sharedMemory: true, atomics: true, memory: 'section' }), { threads: true }).errors;
  assert.ok(errors.some((e) => /the module defines a memory: a side module imports/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /no shared memory import: a threaded side module imports/.test(e)), errors.join('\n'));
  // A non-shared memory defined by the module also fails.
  const plain = checkWasm(buildModule({ atomics: true, memory: 'section' }), { threads: true }).errors;
  assert.ok(plain.some((e) => /defines a memory/.test(e)), plain.join('\n'));
});

test('a threaded module without dylink.0 is not a side module (L4.20)', () => {
  const errors = checkWasm(buildModule({ sharedMemory: true, atomics: true, dylink: false }), { threads: true }).errors;
  assert.deepEqual(errors, ['no "dylink.0" section: not an Emscripten side module (SIDE_MODULE)']);
});

test('a threaded module without the entry symbol fails with --threads (L4.20)', () => {
  const errors = checkWasm(buildModule({ sharedMemory: true, atomics: true, exports: ['other'] }), { threads: true }).errors;
  assert.deepEqual(errors, ['the entry symbol "gdext_rust_init" is not exported']);
  assert.deepEqual(checkWasm(buildModule({ sharedMemory: true, atomics: true, exports: ['other'] }), { threads: true, entrySymbol: 'other' }).errors, []);
});

test('the threaded budget is inclusive: equal passes, one byte more fails with LD38 (LD38)', () => {
  const bytes = buildModule({ sharedMemory: true, atomics: true, padding: 100 });
  assert.deepEqual(checkWasm(bytes, { threads: true, budget: bytes.length }).errors, []);
  assert.deepEqual(checkWasm(bytes, { threads: true, budget: bytes.length - 1 }).errors,
    [`size ${bytes.length} bytes exceeds the budget of ${bytes.length - 1} bytes (LD38)`]);
});

test('readThreadsBudget reads WASM_THREADS_BUDGET_BYTES, separately from WASM_BUDGET_BYTES (LD38)', () => {
  const text = readFileSync(repoVersions, 'utf8');
  const threadsBudget = readThreadsBudget(text);
  assert.ok(Number.isInteger(threadsBudget) && threadsBudget > 0, `threads budget ${threadsBudget}`);
  assert.equal(threadsBudget, readBudget(text, 'WASM_THREADS_BUDGET_BYTES'));
  assert.equal(readThreadsBudget('WASM_BUDGET_BYTES=1000\n'), undefined, 'the non-threaded budget is not the threaded one');
  assert.equal(readThreadsBudget('WASM_THREADS_BUDGET_BYTES=1000\r\n'), 1000);
  assert.equal(readThreadsBudget('# WASM_THREADS_BUDGET_BYTES=1000\n'), undefined);
  assert.equal(readThreadsBudget('WASM_THREADS_BUDGET_BYTES=1M\n'), undefined);
  assert.equal(readThreadsBudget('WASM_THREADS_BUDGET_BYTES=-5\n'), undefined);
  assert.equal(readThreadsBudget('WASM_THREADS_BUDGET_BYTES=\n'), undefined);
});

// --- Atomics count and decoder (L4.20: the count, every class of atomic instruction) ------------------

test('the atomics count runs over every function, not only the first one that has atomics (L4.20)', () => {
  const bytes = buildModule({
    sharedMemory: true,
    functions: [
      { code: [0x01, 0xfe, 0x03, 0x00, 0xfe, 0x03, 0x00] }, // two fences
      { code: [0x41, 0x00, ...NOTIFY] },                    // one notify after an i32.const
      { code: [0x01] },                                     // none
      { code: [0xfe, 0x10, 0x02, 0x00] },                   // one load
    ],
  });
  assert.equal(parseWasm(bytes, { countAtomics: true }).atomicsCount, 4);
  assert.equal(checkWasm(bytes, { threads: true }).info.atomicsCount, 4);
});

test('every assigned atomics sub-opcode is decoded and counted: notify, waits, fence, loads, stores, rmw, cmpxchg (L4.20)', () => {
  const memarg = [0x02, 0x80, 0x01]; // align 2, offset 128 (two-byte LEB128)
  const subs = [0x00, 0x01, 0x02, ...Array.from({ length: 0x4e - 0x10 + 1 }, (_, i) => 0x10 + i)];
  for (const sub of subs) {
    const bytes = buildModule({ sharedMemory: true, functions: [{ code: [0xfe, sub, ...memarg] }] });
    const parsed = parseWasm(bytes, { countAtomics: true });
    assert.equal(parsed.error, undefined, `0xfe 0x${sub.toString(16)}: ${parsed.error}`);
    assert.equal(parsed.atomicsCount, 1, `0xfe 0x${sub.toString(16)}`);
  }
  const fence = buildModule({ sharedMemory: true, functions: [{ code: [0xfe, 0x03, 0x00] }] });
  assert.equal(parseWasm(fence, { countAtomics: true }).atomicsCount, 1, 'atomic.fence (one reserved byte)');
  // atomic.fence has no memarg: the byte after its reserved byte is a separate instruction (nop, then the fence).
  const twoFences = buildModule({ sharedMemory: true, functions: [{ code: [0xfe, 0x03, 0x00, 0x01, 0xfe, 0x03, 0x00] }] });
  assert.equal(parseWasm(twoFences, { countAtomics: true }).atomicsCount, 2);
});

test('atomics immediates that look like other opcodes do not desynchronise the walk (L4.20, L4.17)', () => {
  const code = [
    0xfe, 0x10, 0x02, 0x0b, // i32.atomic.load, offset 0x0b (looks like end)
    0xfe, 0x17, 0x02, 0x10, // i64.atomic.store ... offset 0x10 (looks like call), then nop below
    0x01,
    0xfe, 0x48, 0x02, 0xfe, 0x01, // cmpxchg, offset 254 (two-byte LEB128 with 0xfe)
    0xfe, 0x1e, 0x00, 0x0f, // rmw add, offset 0x0f (looks like return)
    0xfe, 0x01, 0x02, 0x0b, // memory.atomic.wait32, offset 0x0b
    0xfe, 0x02, 0x03, 0x0c, // wait64, offset 0x0c (looks like br)
  ];
  const bytes = buildModule({ sharedMemory: true, functions: [{ code }] });
  const parsed = parseWasm(bytes, { countAtomics: true });
  assert.equal(parsed.error, undefined, parsed.error);
  assert.equal(parsed.atomicsCount, 6);
  // The same code in a non-threaded module: the walk stops at the first atomics, which follows the nop.
  const plain = buildModule({ functions: [{ code: [0x01, ...code] }] });
  assert.equal(parseWasm(plain).atomicsAt, plain.length - 1 - code.length, 'the first atomics, after the nop, at its own offset');
});

test('an unknown 0xFE sub-opcode fails closed with --threads, naming the sub-opcode (L4.20, L4.17)', () => {
  for (const sub of [0x04, 0x0f, 0x4f, 0x50, 0x7f, 0xff, 0x100]) {
    const bytes = buildModule({ sharedMemory: true, functions: [{ code: [0x01, 0xfe, ...leb(sub), 0x00, 0x00, ...FENCE] }] });
    const errors = checkWasm(bytes, { threads: true }).errors;
    assert.equal(errors.length, 1, `0x${sub.toString(16)}: ${errors.join('; ')}`);
    assert.match(errors[0], new RegExp(`malformed WebAssembly binary: unknown instruction 0xfe sub-opcode 0x${sub.toString(16)} at offset \\d+`));
    // Without --threads an atomics-like instruction is still a failure, never a pass.
    assert.ok(checkWasm(bytes).errors.length >= 1, `0x${sub.toString(16)} passed without --threads`);
  }
});

test('the threaded walk fails on a body that overruns after the atomics (L4.20: no silent pass)', () => {
  // The atomic's offset LEB is cut by the end of the body: the walk runs past the body.
  const bytes = buildModule({ sharedMemory: true, functions: [{ code: [0xfe, 0x10, 0x02, 0x80] }] });
  const errors = checkWasm(bytes, { threads: true }).errors;
  assert.equal(errors.length, 1, errors.join('; '));
  assert.match(errors[0], /malformed WebAssembly binary/);
});

// --- Command line: --threads ----------------------------------------------------------------------------

const threadedGood = fixture(THREADED_NAME, { sharedMemory: true, atomics: true });
const threadedBig = fixture('big.threads.wasm', { sharedMemory: true, atomics: true, padding: 4096 });
const plainNamedThreads = fixture('plain.threads.wasm', {});
const sharedNoAtomics = fixture('shared-no-atomics.threads.wasm', { sharedMemory: true });
const atomicsNoShared = fixture('atomics-no-shared.threads.wasm', { atomics: true });
const definedMemory = fixture('defined-memory.threads.wasm', { sharedMemory: true, atomics: true, memory: 'section' });
const noEntryThreaded = fixture('no-entry.threads.wasm', { sharedMemory: true, atomics: true, exports: ['other'] });
const threadedNoDylink = fixture('no-dylink.threads.wasm', { sharedMemory: true, atomics: true, dylink: false });

test('the command line: --threads passes the threaded library and reports its atomics count (L4.20)', () => {
  const result = run([threadedGood, '--threads', '--budget', '100000']);
  assert.equal(result.status, 0, result.err);
  assert.match(result.out, /1 atomics instructions, budget 100000 bytes/);
  assert.match(result.out, /check-wasm: ok/);
  // --threads may come before the file.
  assert.equal(run(['--threads', threadedGood, '--budget', '100000']).status, 0);
});

test('the command line: --threads twice, and --threads alone, are usage errors (exit 2)', () => {
  assert.equal(run([threadedGood, '--threads', '--threads', '--budget', '100000']).status, 2);
  assert.equal(run(['--threads']).status, 2);
  assert.match(run(['--threads']).err, /usage:/);
});

test('the command line: --threads with only --gdextension checks nothing, so it is a usage error, not a pass', () => {
  assert.equal(run(['--threads', '--gdextension', repoGdextension]).status, 2);
});

test('the command line: a non-threaded module with --threads fails, a threaded one without fails (both ways)', () => {
  const plainAsThreads = run([good, '--threads', '--budget', '100000']);
  assert.equal(plainAsThreads.status, 1);
  assert.match(plainAsThreads.err, /not a threaded library name/);
  assert.match(plainAsThreads.err, /no shared memory import/);
  const threadedAsPlain = run([threadedGood, '--budget', '100000']);
  assert.equal(threadedAsPlain.status, 1);
  assert.match(threadedAsPlain.err, /check it with --threads/);
  assert.match(threadedAsPlain.err, /shared memory: this is a threaded build/);
});

test('the command line: broken threaded modules fail with --threads, each with its reason', () => {
  const cases = [
    [sharedNoAtomics, /no atomics instruction/],
    [atomicsNoShared, /no shared memory import/],
    [definedMemory, /defines a memory/],
    [noEntryThreaded, /entry symbol "gdext_rust_init" is not exported/],
    [threadedNoDylink, /no "dylink\.0" section/],
  ];
  for (const [path, reason] of cases) {
    const result = run([path, '--threads', '--budget', '100000']);
    assert.equal(result.status, 1, path);
    assert.match(result.err, reason, path);
  }
  // A plain-named file with threaded content, or a threaded name with plain content, fails on the name alone plus its content.
  assert.match(run([plainNamedThreads, '--threads', '--budget', '100000']).err, /no shared memory import/);
});

test('the command line: --budget overrides the threaded budget in both directions (LD38)', () => {
  // Over the explicit budget: fails and names the threaded budget rule.
  const over = run([threadedBig, '--threads', '--budget', '1000']);
  assert.equal(over.status, 1);
  assert.match(over.err, /exceeds the budget of 1000 bytes \(LD38\)/);
  // A larger explicit budget passes the same file, whatever versions.env says.
  assert.equal(run([threadedBig, '--threads', '--budget', '100000000']).status, 0);
  // A budget of 0 is a budget, not a missing one.
  assert.equal(run([threadedGood, '--threads', '--budget', '0']).status, 1);
});

test('the command line: the threaded budget is WASM_THREADS_BUDGET_BYTES, equal size passes, one byte less fails (LD38)', () => {
  const bytes = readFileSync(threadedGood);
  const exact = run([threadedGood, '--threads', '--budget', String(bytes.length)]);
  assert.equal(exact.status, 0, exact.err);
  const under = run([threadedGood, '--threads', '--budget', String(bytes.length - 1)]);
  assert.equal(under.status, 1);
  assert.match(under.err, /exceeds the budget/);
});

test('the command line: without --threads the threaded library is not the budget source (nothing silently mixed)', () => {
  const expected = readThreadsBudget(readFileSync(repoVersions, 'utf8'));
  const result = run([threadedGood, '--threads']);
  assert.equal(result.status, 0, result.err);
  assert.match(result.out, new RegExp(`budget ${expected} bytes`));
});

test('the command line: a versions.env without WASM_THREADS_BUDGET_BYTES, or with a malformed one, fails with --threads (LD38, L4.20)', () => {
  const folder = mkdtempSync(join(work, 'threads-copy-'));
  copyFileSync(script, join(folder, 'check-wasm.mjs'));
  const cases = [
    ['missing', 'WASM_BUDGET_BYTES=651012\nRUST_NIGHTLY=nightly\n'],
    ['commented', '# WASM_THREADS_BUDGET_BYTES=1000000\nWASM_BUDGET_BYTES=651012\n'],
    ['with a unit', 'WASM_THREADS_BUDGET_BYTES=1M\n'],
    ['empty', 'WASM_THREADS_BUDGET_BYTES=\n'],
    ['negative', 'WASM_THREADS_BUDGET_BYTES=-5\n'],
    ['fraction', 'WASM_THREADS_BUDGET_BYTES=1000.5\n'],
  ];
  for (const [name, content] of cases) {
    writeFileSync(join(folder, 'versions.env'), content);
    const result = spawnSync(process.execPath, [join(folder, 'check-wasm.mjs'), threadedGood, '--threads'], { encoding: 'utf8' });
    assert.equal(result.status, 1, `${name}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /WASM_THREADS_BUDGET_BYTES/, name);
    assert.match(result.stderr, /\(LD38\)/, name);
    // An explicit --budget makes the value unnecessary: the check runs.
    const explicit = spawnSync(process.execPath, [join(folder, 'check-wasm.mjs'), threadedGood, '--threads', '--budget', '100000'], { encoding: 'utf8' });
    assert.equal(explicit.status, 0, `${name} with --budget: ${explicit.stdout}${explicit.stderr}`);
  }
});

// --- .gdextension: the four web keys (L4.20, LD35, LD38) -----------------------------------------------

const keyLine = (key) => repoGdextensionText.split(/\r?\n/).find((l) => l.startsWith(`${key} = `));
const WEB_FOUR = ['web.debug.wasm32', 'web.release.wasm32', 'web.debug.threads.wasm32', 'web.release.threads.wasm32'];

test('checkGdextension: each of the four web keys is required, and a missing one is named (L4.20)', () => {
  for (const key of WEB_FOUR) {
    const text = repoGdextensionText.split(/\r?\n/).filter((l) => !l.startsWith(`${key} = `)).join('\n');
    assert.deepEqual(checkGdextension(text), [`${key} is missing from [libraries]`], key);
  }
});

test('checkGdextension: a threaded path under a non-threaded key, and the reverse, fail (swapped paths, L4.20)', () => {
  const swapped = repoGdextensionText
    .replace(keyLine('web.debug.wasm32'), 'web.debug.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.threads.wasm"')
    .replace(keyLine('web.debug.threads.wasm32'), 'web.debug.threads.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.wasm"');
  assert.deepEqual(checkGdextension(swapped), [
    'web.debug.wasm32 is "res://addons/mumble_speech/bin/mumble_godot.threads.wasm", expected "res://addons/mumble_speech/bin/mumble_godot.wasm"',
    'web.debug.threads.wasm32 is "res://addons/mumble_speech/bin/mumble_godot.wasm", expected "res://addons/mumble_speech/bin/mumble_godot.threads.wasm"',
  ]);
  // Only one of the two keys swapped: exactly one error.
  const oneSwap = repoGdextensionText.replace(keyLine('web.release.threads.wasm32'),
    'web.release.threads.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.wasm"');
  assert.equal(checkGdextension(oneSwap).length, 1);
  // Every web key pointing at the other library: four errors, each naming its key.
  const allSwapped = repoGdextensionText
    .replace(keyLine('web.debug.wasm32'), 'web.debug.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.threads.wasm"')
    .replace(keyLine('web.release.wasm32'), 'web.release.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.threads.wasm"')
    .replace(keyLine('web.debug.threads.wasm32'), 'web.debug.threads.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.wasm"')
    .replace(keyLine('web.release.threads.wasm32'), 'web.release.threads.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.wasm"');
  const errors = checkGdextension(allSwapped);
  assert.equal(errors.length, 4);
  for (const key of WEB_FOUR) assert.ok(errors.some((e) => e.startsWith(`${key} is `)), key);
});

test('checkGdextension: any extra web key fails, a non-web key does not (LD35, LD38)', () => {
  for (const extra of ['web.release.nothreads.wasm32', 'web.debug.threads.wasm64', 'web.wasm32', 'web.release.threads.wasm32.extra']) {
    const errors = checkGdextension(`${repoGdextensionText}\n${extra} = "res://addons/mumble_speech/bin/mumble_godot.wasm"\n`);
    assert.deepEqual(errors, [`${extra}: not one of the four web keys (${[...WEB_KEYS, ...WEB_THREADS_KEYS].join(', ')}) (LD35)`], extra);
  }
  assert.deepEqual(checkGdextension(`${repoGdextensionText}\nlinux.release.arm64 = "res://a.so"\n`), []);
});

test('checkGdextension: the four keys under another section, or after [other], do not count', () => {
  const afterOther = `${repoGdextensionText}\n[other]\n${WEB_FOUR.map((k) => `${k} = "x"`).join('\n')}\n`;
  // The keys after [other] are not [libraries] entries: the four are missing from [libraries], and they are not extra either.
  assert.equal(checkGdextension(afterOther).filter((e) => e.endsWith('is missing from [libraries]')).length, 0);
  const libsSplit = repoGdextensionText.replace('[libraries]', `[other]\n${WEB_FOUR.map((k) => `${k} = "x"`).join('\n')}\n[libraries]`);
  assert.deepEqual(checkGdextension(libsSplit), [], 'the keys in [other] are not counted as extra web keys');
  const commented = repoGdextensionText.split(/\r?\n/).map((l) => (l.startsWith('web.release.threads.wasm32') ? `; ${l}` : l)).join('\n');
  assert.deepEqual(checkGdextension(commented), ['web.release.threads.wasm32 is missing from [libraries]']);
});

test('checkGdextension: comment lines (; and #) never count as keys, in LF and CRLF (L4.20)', () => {
  const lines = repoGdextensionText.split(/\r?\n/).map((l) => (l.startsWith('web.') ? `# ${l}` : l));
  const text = lines.join('\n');
  assert.equal(checkGdextension(text).length, 4);
  assert.equal(checkGdextension(text.replace(/\n/g, '\r\n')).length, 4);
  // A commented-out web key next to the real one changes nothing.
  assert.deepEqual(checkGdextension(`${repoGdextensionText}\n; web.release.nothreads.wasm32 = "x"\n# web.debug.threads.wasm64 = "y"\n`), []);
});

test('checkGdextension: CRLF with a swapped path is still reported, with the same message (L4.20)', () => {
  const swapped = repoGdextensionText.replace(keyLine('web.release.wasm32'), 'web.release.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.threads.wasm"');
  assert.deepEqual(checkGdextension(crlf(swapped)), [
    'web.release.wasm32 is "res://addons/mumble_speech/bin/mumble_godot.threads.wasm", expected "res://addons/mumble_speech/bin/mumble_godot.wasm"',
  ]);
});

test('the command line: the .gdextension with a threaded key swapped fails, and names the key (L4.20)', () => {
  const swapped = join(work, 'swapped.gdextension');
  writeFileSync(swapped, repoGdextensionText.replace(keyLine('web.release.threads.wasm32'),
    'web.release.threads.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.wasm"'));
  const result = run(['--gdextension', swapped]);
  assert.equal(result.status, 1);
  assert.match(result.err, /web\.release\.threads\.wasm32 is "res:\/\/addons\/mumble_speech\/bin\/mumble_godot\.wasm"/);
});
