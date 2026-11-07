// Checks of the Godot web libraries (specs/design.md §9.3.1, §9.3.2, L4.17, L4.20): the file must be a
// WebAssembly Emscripten side module built without threads (default) or with them (--threads: shared
// memory imported, atomics present), export the GDExtension entry symbol and stay within the size
// budget of its mode; the .gdextension file must list exactly the four web keys. No dependencies. The checks are pure functions on bytes and text (exported, tested by
// check-wasm.test.sh); the command line is a thin wrapper.
//
// Usage: node scripts/godot-web/check-wasm.mjs [<library.wasm>] [--threads] [--gdextension <file>] [--budget <bytes>]
//   --threads checks the threaded library (mumble_godot.threads.wasm); the file name and the mode must agree.
//   Without --budget, WASM_BUDGET_BYTES (WASM_THREADS_BUDGET_BYTES with --threads) from versions.env
//   (next to this script) is the budget.
//   Without --gdextension, the entry symbol is gdext_rust_init.
//   Exit status: 0 when every check passes, 1 when one fails, 2 on a usage error.
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const DEFAULT_ENTRY_SYMBOL = 'gdext_rust_init';
export const WEB_LIBRARY_PATH = 'res://addons/mumble_speech/bin/mumble_godot.wasm';
export const THREADS_LIBRARY_PATH = 'res://addons/mumble_speech/bin/mumble_godot.threads.wasm';
export const WEB_KEYS = ['web.debug.wasm32', 'web.release.wasm32'];
export const WEB_THREADS_KEYS = ['web.debug.threads.wasm32', 'web.release.threads.wasm32'];

class DecodeError extends Error {}

/** Reads a section's bytes with bounds checks; every read past the end is a DecodeError. */
class Reader {
  constructor(bytes, pos = 0, end = bytes.length) {
    this.bytes = bytes;
    this.pos = pos;
    this.end = end;
  }
  byte() {
    if (this.pos >= this.end) throw new DecodeError(`truncated at offset ${this.pos}`);
    return this.bytes[this.pos++];
  }
  skip(n) {
    if (this.pos + n > this.end) throw new DecodeError(`truncated at offset ${this.pos}`);
    this.pos += n;
  }
  // Unsigned LEB128 as a Number (exact up to 2^53; larger values only appear as skipped offsets).
  u() {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      const b = this.byte();
      result += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) return result;
      scale *= 128;
    }
    throw new DecodeError(`LEB128 too long at offset ${this.pos}`);
  }
  // Signed LEB128, skipped (constants and block types are never used by the checks).
  sSkip() {
    for (let i = 0; i < 10; i++) if ((this.byte() & 0x80) === 0) return;
    throw new DecodeError(`LEB128 too long at offset ${this.pos}`);
  }
  name() {
    const length = this.u();
    const start = this.pos;
    this.skip(length);
    return new TextDecoder('utf-8').decode(this.bytes.subarray(start, start + length));
  }
}

// Memory limits: flag bit 0 has a maximum, bit 1 is shared, bit 2 is 64-bit (threads proposal).
function readLimits(r) {
  const flags = r.u();
  r.u();
  if (flags & 0x01) r.u();
  return { shared: (flags & 0x02) !== 0 };
}

function memarg(r) {
  const align = r.u();
  if (align & 0x40) r.u(); // multi-memory: an explicit memory index follows
  r.u();
}

// A value type: one byte, or two for a reference type (0x63 or 0x64 and a heap type).
function valtype(r) {
  const t = r.byte();
  if (t === 0x63 || t === 0x64) r.sSkip();
}

// The 0xFD (vector) sub-opcodes of the WebAssembly 3.0 binary format (spec "Instruction Index",
// SIMD 0x00-0xFF with its reserved gaps, relaxed SIMD 0x100-0x113) and their immediates. Anything
// not listed is unassigned: the decoder fails on it, because an unknown immediate layout would
// desynchronise the walk and could hide an atomics instruction (L4.17).
const SIMD_MEMARG = [[0x00, 0x0b], [0x5c, 0x5d]]; // v128.load*, v128.store, load32_zero, load64_zero
const SIMD_MEMARG_LANE = [[0x54, 0x5b]]; // v128.load*_lane, v128.store*_lane
const SIMD_LANE = [[0x15, 0x22]]; // extract_lane, replace_lane
const SIMD_V128 = [[0x0c, 0x0c]]; // v128.const: 16 bytes
const SIMD_SHUFFLE = [[0x0d, 0x0d]]; // i8x16.shuffle: 16 lane indices
// Assigned, no immediates. The reserved codes between the ranges are 0x9a, 0xa2, 0xa5, 0xa6, 0xaf,
// 0xb0, 0xb2-0xb4, 0xbb, 0xc2, 0xc5, 0xc6, 0xcf, 0xd0, 0xd2-0xd4, 0xe2, 0xee.
const SIMD_NONE = [
  [0x0e, 0x14], [0x23, 0x53], [0x5e, 0x99], [0x9b, 0xa1], [0xa3, 0xa4], [0xa7, 0xae], [0xb1, 0xb1],
  [0xb5, 0xba], [0xbc, 0xc1], [0xc3, 0xc4], [0xc7, 0xce], [0xd1, 0xd1], [0xd5, 0xe1], [0xe3, 0xed],
  [0xef, 0x113], // 0x100-0x113: relaxed SIMD
];
const inRanges = (ranges, n) => ranges.some(([lo, hi]) => n >= lo && n <= hi);

/** Immediate layout of a 0xFD sub-opcode, or undefined when the sub-opcode is not assigned. */
export function simdImmediates(sub) {
  if (inRanges(SIMD_MEMARG, sub)) return 'memarg';
  if (inRanges(SIMD_MEMARG_LANE, sub)) return 'memarg+lane';
  if (inRanges(SIMD_LANE, sub)) return 'lane';
  if (inRanges(SIMD_V128, sub)) return 'v128';
  if (inRanges(SIMD_SHUFFLE, sub)) return 'shuffle';
  if (inRanges(SIMD_NONE, sub)) return 'none';
  return undefined;
}

// The 0xFE (atomics) sub-opcodes of the threads proposal: notify and the two waits (0x00-0x02), loads,
// stores and read-modify-write (0x10-0x4e) have a memarg; atomic.fence (0x03) has one reserved byte.
const ATOMICS_MEMARG = [[0x00, 0x02], [0x10, 0x4e]];

/**
 * Walks the instructions of one function body (after its locals). `state.first` keeps the offset of
 * the first atomics instruction (prefix 0xFE), -1 if there is none. By default the walk stops at the
 * first one; with `all` it decodes the atomics instruction and goes on, counting them in
 * `state.count` (L4.20 reports the count). Every opcode of the MVP and of the finished proposals
 * Emscripten and LLVM emit is decoded, so immediates are never mistaken for opcodes; an opcode that
 * is not known is an error, not a pass.
 */
function findAtomics(r, bodyEnd, state, all) {
  let lastAt = -1;
  let lastOp = -1;
  while (r.pos < bodyEnd) {
    const at = r.pos;
    const op = r.byte();
    lastAt = at;
    lastOp = op;
    if (op === 0xfe) {
      if (state.first < 0) state.first = at;
      state.count++;
      if (!all) return;
      const sub = r.u();
      if (inRanges(ATOMICS_MEMARG, sub)) memarg(r);
      else if (sub === 0x03) r.skip(1);
      else throw new DecodeError(`unknown instruction 0xfe sub-opcode 0x${sub.toString(16)} at offset ${at}`);
      continue;
    }
    if (op >= 0x45 && op <= 0xc4) continue; // numeric instructions, sign extension included
    switch (op) {
      case 0x00: case 0x01: case 0x05: case 0x0b: case 0x0f: case 0x0a: case 0x19:
      case 0x1a: case 0x1b: case 0xd1: case 0xd3: case 0xd4:
        break;
      case 0x02: case 0x03: case 0x04: case 0x06: // block, loop, if, try: block type
        r.sSkip();
        break;
      case 0x07: case 0x08: case 0x09: case 0x0c: case 0x0d: case 0x10: case 0x12: case 0x14:
      case 0x15: case 0x18: case 0x20: case 0x21: case 0x22: case 0x23: case 0x24: case 0x25:
      case 0x26: case 0xd2: case 0xd5: case 0xd6: // one index
        r.u();
        break;
      case 0x0e: { // br_table
        const count = r.u();
        for (let i = 0; i <= count; i++) r.u();
        break;
      }
      case 0x11: case 0x13: // call_indirect, return_call_indirect: type, table
        r.u();
        r.u();
        break;
      case 0x1c: { // select with types
        const count = r.u();
        for (let i = 0; i < count; i++) valtype(r);
        break;
      }
      case 0x1f: { // try_table: block type, catch clauses
        r.sSkip();
        const count = r.u();
        for (let i = 0; i < count; i++) {
          const kind = r.byte();
          if (kind === 0 || kind === 1) r.u();
          r.u();
        }
        break;
      }
      case 0x3f: case 0x40: // memory.size, memory.grow
        r.u();
        break;
      case 0x41: case 0x42:
        r.sSkip();
        break;
      case 0x43:
        r.skip(4);
        break;
      case 0x44:
        r.skip(8);
        break;
      case 0xd0: // ref.null: heap type
        r.sSkip();
        break;
      case 0xfc: {
        const sub = r.u();
        if (sub <= 7) break; // saturating truncation
        if (sub === 8) { r.u(); r.u(); break; } // memory.init
        if (sub === 9 || sub === 11 || sub === 13 || (sub >= 15 && sub <= 17)) { r.u(); break; }
        if (sub === 10 || sub === 12 || sub === 14) { r.u(); r.u(); break; }
        throw new DecodeError(`unknown instruction 0xfc ${sub} at offset ${at}`);
      }
      case 0xfd: { // SIMD and relaxed SIMD: the sub-opcode decides the immediates
        const sub = r.u();
        const kind = simdImmediates(sub);
        if (kind === undefined) throw new DecodeError(`unknown instruction 0xfd sub-opcode 0x${sub.toString(16)} at offset ${at}`);
        if (kind === 'memarg' || kind === 'memarg+lane') memarg(r);
        if (kind === 'lane' || kind === 'memarg+lane') r.skip(1);
        else if (kind === 'v128') r.skip(16);
        else if (kind === 'shuffle') r.skip(16);
        break;
      }
      default:
        if (op >= 0x28 && op <= 0x3e) { memarg(r); break; } // loads and stores
        throw new DecodeError(`unknown instruction 0x${op.toString(16)} at offset ${at}`);
    }
  }
  if (r.pos !== bodyEnd) throw new DecodeError(`function body overruns its size at offset ${r.pos}`);
  // The body ends with its `end`, read as an opcode: an immediate that swallowed it is a malformed body.
  if (lastOp !== 0x0b || lastAt !== bodyEnd - 1) throw new DecodeError(`function body does not end with end at offset ${bodyEnd - 1}`);
}

/**
 * Reads the parts of a WebAssembly binary the checks need.
 * Returns { error } on a malformed file; otherwise
 * { sections, dylink, imports, memories, exports, atomicsAt }, where `imports` and `memories` carry
 * the `shared` flag, `exports` are names, and `atomicsAt` is the offset of the first atomics
 * instruction (or -1). With `countAtomics` the whole code section is walked and `atomicsCount`
 * (every atomics instruction) is added.
 */
export function parseWasm(bytes, { countAtomics = false } = {}) {
  const out = { sections: [], dylink: false, imports: [], memories: [], exports: [], atomicsAt: -1 };
  try {
    if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
      return { error: 'not a WebAssembly binary (bad magic)' };
    }
    if (bytes[4] !== 1 || bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 0) {
      const word = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
      return { error: `unsupported WebAssembly version 0x${word.toString(16).padStart(8, '0')} (little-endian word, expected 0x00000001)` };
    }
    const top = new Reader(bytes, 8);
    while (top.pos < bytes.length) {
      const id = top.byte();
      const size = top.u();
      const start = top.pos;
      const end = start + size;
      if (end > bytes.length) throw new DecodeError(`section ${id} runs past the end of the file`);
      const r = new Reader(bytes, start, end);
      out.sections.push(id);
      if (id === 0) {
        if (r.name() === 'dylink.0') out.dylink = true;
      } else if (id === 2) {
        const count = r.u();
        for (let i = 0; i < count; i++) {
          const module = r.name();
          const name = r.name();
          const kind = r.byte();
          if (kind === 0) r.u();
          else if (kind === 1) { r.byte(); readLimits(r); }
          else if (kind === 2) out.imports.push({ module, name, shared: readLimits(r).shared });
          else if (kind === 3) { valtype(r); r.byte(); }
          else if (kind === 4) { r.byte(); r.u(); }
          else throw new DecodeError(`unknown import kind ${kind}`);
        }
      } else if (id === 5) {
        const count = r.u();
        for (let i = 0; i < count; i++) out.memories.push(readLimits(r));
      } else if (id === 7) {
        const count = r.u();
        for (let i = 0; i < count; i++) {
          out.exports.push(r.name());
          r.byte();
          r.u();
        }
      } else if (id === 10 && (countAtomics || out.atomicsAt < 0)) {
        const state = { first: out.atomicsAt, count: 0 };
        const count = r.u();
        for (let i = 0; i < count && (countAtomics || state.first < 0); i++) {
          const bodySize = r.u();
          const bodyEnd = r.pos + bodySize;
          if (bodyEnd > end) throw new DecodeError('function body runs past the code section');
          const locals = r.u();
          for (let j = 0; j < locals; j++) { r.u(); valtype(r); }
          findAtomics(r, bodyEnd, state, countAtomics);
        }
        out.atomicsAt = state.first;
        if (countAtomics) out.atomicsCount = state.count;
      }
      top.pos = end;
    }
  } catch (e) {
    if (e instanceof DecodeError) return { error: `malformed WebAssembly binary: ${e.message}` };
    throw e;
  }
  return out;
}

/** The file-name rule of LD38: the threaded library is `*.threads.wasm`, the other is not. Returns an error or undefined. */
export function checkModeName(fileName, threads) {
  const threadedName = fileName.endsWith('.threads.wasm');
  if (threadedName && !threads) return `file name "${fileName}" is the threaded library: check it with --threads (LD38)`;
  if (!threadedName && threads) return `file name "${fileName}" is not a threaded library name (*.threads.wasm): --threads checks only that (LD38)`;
  return undefined;
}

/**
 * The checks of L4.17 (default) or L4.20 (`threads`) on the bytes of the library. Returns { errors,
 * info }: `errors` is a list of messages (empty when everything passes), `info` has the raw and gzip
 * sizes (for the run summary) and, with `threads`, the number of atomics instructions. `fileName`,
 * when given, must agree with the mode (LD38).
 */
export function checkWasm(bytes, { entrySymbol = DEFAULT_ENTRY_SYMBOL, budget, threads = false, fileName } = {}) {
  const info = { rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length };
  const errors = [];
  if (fileName !== undefined) {
    const nameError = checkModeName(fileName, threads);
    if (nameError) errors.push(nameError);
  }
  const parsed = parseWasm(bytes, { countAtomics: threads });
  if (parsed.error) return { errors: [...errors, parsed.error], info };
  if (!parsed.dylink) errors.push('no "dylink.0" section: not an Emscripten side module (SIDE_MODULE)');
  if (threads) {
    info.atomicsCount = parsed.atomicsCount;
    const sharedImports = parsed.imports.filter((i) => i.shared);
    if (parsed.memories.length > 0) {
      errors.push('the module defines a memory: a side module imports the engine\'s shared memory (L4.20)');
    }
    if (sharedImports.length === 0) {
      errors.push(parsed.imports.length > 0
        ? 'no shared memory import: the imported memory is not shared, this is not a threaded build (L4.20)'
        : 'no shared memory import: a threaded side module imports the engine\'s shared memory (L4.20)');
    }
    if (parsed.atomicsCount === 0) errors.push('no atomics instruction: this is not a threaded build (L4.20)');
  } else {
    if (parsed.imports.some((i) => i.shared) || parsed.memories.some((m) => m.shared)) {
      errors.push('shared memory: this is a threaded build (L4.17: no threads)');
    }
    if (parsed.atomicsAt >= 0) {
      errors.push(`atomics instruction at offset ${parsed.atomicsAt}: this is a threaded build (L4.17: no threads)`);
    }
  }
  if (!parsed.exports.includes(entrySymbol)) errors.push(`the entry symbol "${entrySymbol}" is not exported`);
  if (budget !== undefined && bytes.length > budget) {
    errors.push(`size ${bytes.length} bytes exceeds the budget of ${budget} bytes (${threads ? 'LD38' : 'LD34'})`);
  }
  return { errors, info };
}

/** `entry_symbol` of a .gdextension file, or undefined. */
export function readEntrySymbol(text) {
  const match = text.match(/^\s*entry_symbol\s*=\s*"([^"]*)"/m);
  return match ? match[1] : undefined;
}

/** The `[libraries]` entries of a .gdextension file as { key: value }. */
export function readLibraries(text) {
  const libraries = {};
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^\[(.*)\]$/);
    if (header) {
      section = header[1];
      continue;
    }
    const entry = line.match(/^([^=;#\s]+)\s*=\s*"([^"]*)"\s*$/);
    if (section === 'libraries' && entry) libraries[entry[1]] = entry[2];
  }
  return libraries;
}

/**
 * The web entries of the .gdextension file (L4.17, L4.20, LD35, LD38): exactly the four keys, each with
 * its own library path. Returns a list of error messages.
 */
export function checkGdextension(text, { path = WEB_LIBRARY_PATH, threadsPath = THREADS_LIBRARY_PATH } = {}) {
  const libraries = readLibraries(text);
  const errors = [];
  const expected = [...WEB_KEYS.map((key) => [key, path]), ...WEB_THREADS_KEYS.map((key) => [key, threadsPath])];
  for (const [key, want] of expected) {
    if (!(key in libraries)) errors.push(`${key} is missing from [libraries]`);
    else if (libraries[key] !== want) errors.push(`${key} is "${libraries[key]}", expected "${want}"`);
  }
  for (const key of Object.keys(libraries)) {
    if (key.startsWith('web.') && !expected.some(([k]) => k === key)) {
      errors.push(`${key}: not one of the four web keys (${[...WEB_KEYS, ...WEB_THREADS_KEYS].join(', ')}) (LD35)`);
    }
  }
  return errors;
}

/** A whole-number budget variable of versions.env (default WASM_BUDGET_BYTES), or undefined. */
export function readBudget(versionsEnv, name = 'WASM_BUDGET_BYTES') {
  const match = versionsEnv.match(new RegExp(`^${name}=(\\d+)\\s*$`, 'm'));
  return match ? Number(match[1]) : undefined;
}

/** WASM_THREADS_BUDGET_BYTES from versions.env, or undefined. */
export const readThreadsBudget = (versionsEnv) => readBudget(versionsEnv, 'WASM_THREADS_BUDGET_BYTES');

const format = (n) => `${n} bytes (${(n / 1024 / 1024).toFixed(2)} MiB)`;

function main(argv) {
  const args = argv.slice();
  const take = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const value = args[i + 1];
    args.splice(i, value === undefined ? 1 : 2);
    return value ?? '';
  };
  const threadsIndex = args.indexOf('--threads');
  const threads = threadsIndex >= 0;
  if (threads) args.splice(threadsIndex, 1);
  const gdextensionPath = take('--gdextension');
  const budgetArg = take('--budget');
  const unknown = args.filter((a) => a.startsWith('--'));
  // --threads with no library would check nothing (a silent pass): it needs the library.
  if (unknown.length > 0 || args.length > 1 || (args.length === 0 && (gdextensionPath === undefined || threads)) ||
      gdextensionPath === '' || budgetArg === '' || (budgetArg !== undefined && !/^\d+$/.test(budgetArg))) {
    console.error('usage: check-wasm.mjs [<library.wasm>] [--threads] [--gdextension <file>] [--budget <bytes>]');
    return 2;
  }
  const failures = [];
  let entrySymbol = DEFAULT_ENTRY_SYMBOL;
  const read = (path) => {
    try {
      return readFileSync(path);
    } catch (e) {
      failures.push(`${path}: cannot read: ${e.code ?? e.message}`);
      return undefined;
    }
  };
  if (gdextensionPath !== undefined) {
    const text = read(gdextensionPath)?.toString('utf8');
    if (text !== undefined) {
      entrySymbol = readEntrySymbol(text) ?? DEFAULT_ENTRY_SYMBOL;
      for (const message of checkGdextension(text)) failures.push(`${gdextensionPath}: ${message}`);
    }
  }
  if (args.length === 1) {
    let budget = budgetArg === undefined ? undefined : Number(budgetArg);
    if (budget === undefined) {
      const env = join(dirname(fileURLToPath(import.meta.url)), 'versions.env');
      const name = threads ? 'WASM_THREADS_BUDGET_BYTES' : 'WASM_BUDGET_BYTES';
      budget = readBudget(readFileSync(env, 'utf8'), name);
      // A missing or malformed budget must fail: otherwise the size check would silently switch off (L4.17).
      if (budget === undefined) failures.push(`${env}: no ${name} (a whole number of bytes): the size budget cannot be checked (${threads ? 'LD38' : 'LD34'})`);
    }
    const bytes = read(args[0]);
    if (bytes !== undefined) {
      const { errors, info } = checkWasm(bytes, { entrySymbol, budget, threads, fileName: basename(args[0]) });
      console.log(`${args[0]}: raw ${format(info.rawBytes)}, gzip ${format(info.gzipBytes)}` +
        (threads ? `, ${info.atomicsCount ?? 0} atomics instructions` : '') +
        (budget === undefined ? ', no budget' : `, budget ${format(budget)}`));
      for (const message of errors) failures.push(`${args[0]}: ${message}`);
    }
  }
  for (const message of failures) console.error(`FAIL ${message}`);
  if (failures.length === 0) console.log('check-wasm: ok');
  return failures.length === 0 ? 0 : 1;
}

// realpath: a symlinked entry point (a mktemp folder on macOS) must still run, or the check would pass silently.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
