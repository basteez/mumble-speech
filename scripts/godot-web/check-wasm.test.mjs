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
  checkWasm,
  DEFAULT_ENTRY_SYMBOL,
  parseWasm,
  readBudget,
  readEntrySymbol,
  readLibraries,
  WEB_LIBRARY_PATH,
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
  assert.match(parseWasm(bytes).error, /unsupported WebAssembly version 2/);
  const reserved = buildModule();
  reserved[7] = 1; // version word 0x01000001: not version 1
  assert.match(parseWasm(reserved).error, /unsupported/);
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

test('readLibraries returns the eight [libraries] entries of the repository file', () => {
  const libraries = readLibraries(repoGdextensionText);
  assert.deepEqual(Object.keys(libraries).sort(), [
    'linux.debug.x86_64', 'linux.release.x86_64', 'macos.debug', 'macos.release',
    'web.debug.wasm32', 'web.release.wasm32', 'windows.debug.x86_64', 'windows.release.x86_64',
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
  ]);
  // Under [configuration] the web keys are not libraries.
  const underConfiguration = repoGdextensionText.replace('[libraries]', '[configuration]');
  assert.equal(checkGdextension(underConfiguration).length, 2);
  const wrongPath = repoGdextensionText.replace(
    'web.release.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.wasm"',
    'web.release.wasm32 = "res://addons/mumble_speech/bin/other.wasm"',
  );
  assert.deepEqual(checkGdextension(wrongPath), [
    `web.release.wasm32 is "res://addons/mumble_speech/bin/other.wasm", expected "${WEB_LIBRARY_PATH}"`,
  ]);
  const threaded = `${repoGdextensionText}\nweb.release.threads.wasm32 = "res://addons/mumble_speech/bin/mumble_godot.threads.wasm"\n`;
  assert.deepEqual(checkGdextension(threaded), [
    'web.release.threads.wasm32: no threaded web build is shipped (LD27)',
  ]);
  assert.match(checkGdextension(`${repoGdextensionText}\nweb.debug.threads.wasm32 = "x"\n`).join('\n'), /threaded web build/);
});

test('checkGdextension: a web key placed under another section does not count', () => {
  const text = '[configuration]\nweb.debug.wasm32 = "' + WEB_LIBRARY_PATH + '"\nweb.release.wasm32 = "' + WEB_LIBRARY_PATH + '"\n';
  assert.deepEqual(checkGdextension(text), [
    'web.debug.wasm32 is missing from [libraries]',
    'web.release.wasm32 is missing from [libraries]',
  ]);
});

test('checkGdextension: a file without the [libraries] header lists every web key as missing', () => {
  assert.equal(checkGdextension('entry_symbol = "gdext_rust_init"\n').length, 2);
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
