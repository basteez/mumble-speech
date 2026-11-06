// Checks of the Godot web library (specs/design.md §9.3.1, L4.17): the file must be a WebAssembly
// Emscripten side module built without threads, export the GDExtension entry symbol and stay
// within the size budget; the .gdextension file must list it for the two web keys and no threaded
// one. No dependencies. The checks are pure functions on bytes and text (exported, tested by
// check-wasm.test.sh); the command line is a thin wrapper.
//
// Usage: node scripts/godot-web/check-wasm.mjs [<library.wasm>] [--gdextension <file>] [--budget <bytes>]
//   Without --budget, WASM_BUDGET_BYTES from versions.env (next to this script) is the budget.
//   Without --gdextension, the entry symbol is gdext_rust_init.
//   Exit status: 0 when every check passes, 1 when one fails, 2 on a usage error.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export const DEFAULT_ENTRY_SYMBOL = 'gdext_rust_init';
export const WEB_LIBRARY_PATH = 'res://addons/mumble_speech/bin/mumble_godot.wasm';
export const WEB_KEYS = ['web.debug.wasm32', 'web.release.wasm32'];

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

/**
 * Walks the instructions of one function body (after its locals) and returns the offset of the
 * first atomics instruction (prefix 0xFE), or -1 if there is none. Every opcode of the MVP and of
 * the finished proposals Emscripten and LLVM emit is decoded, so immediates are never mistaken
 * for opcodes; an opcode that is not known is an error, not a pass.
 */
function findAtomics(r, bodyEnd) {
  while (r.pos < bodyEnd) {
    const at = r.pos;
    const op = r.byte();
    if (op === 0xfe) return at;
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
      case 0xfd: { // SIMD
        const sub = r.u();
        if (sub <= 0x0b || sub === 0x5c || sub === 0x5d) memarg(r);
        else if (sub === 0x0c || sub === 0x0d) r.skip(16);
        else if ((sub >= 0x15 && sub <= 0x22)) r.skip(1);
        else if (sub >= 0x54 && sub <= 0x5b) { memarg(r); r.skip(1); }
        break;
      }
      default:
        if (op >= 0x28 && op <= 0x3e) { memarg(r); break; } // loads and stores
        throw new DecodeError(`unknown instruction 0x${op.toString(16)} at offset ${at}`);
    }
  }
  if (r.pos !== bodyEnd) throw new DecodeError(`function body overruns its size at offset ${r.pos}`);
  return -1;
}

/**
 * Reads the parts of a WebAssembly binary the checks need.
 * Returns { error } on a malformed file; otherwise
 * { sections, dylink, imports, memories, exports, atomicsAt }, where `imports` and `memories` carry
 * the `shared` flag, `exports` are names, and `atomicsAt` is the offset of the first atomics
 * instruction (or -1).
 */
export function parseWasm(bytes) {
  const out = { sections: [], dylink: false, imports: [], memories: [], exports: [], atomicsAt: -1 };
  try {
    if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
      return { error: 'not a WebAssembly binary (bad magic)' };
    }
    if (bytes[4] !== 1 || bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 0) {
      return { error: `unsupported WebAssembly version ${bytes[4]}` };
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
      } else if (id === 10 && out.atomicsAt < 0) {
        const count = r.u();
        for (let i = 0; i < count && out.atomicsAt < 0; i++) {
          const bodySize = r.u();
          const bodyEnd = r.pos + bodySize;
          if (bodyEnd > end) throw new DecodeError('function body runs past the code section');
          const locals = r.u();
          for (let j = 0; j < locals; j++) { r.u(); valtype(r); }
          out.atomicsAt = findAtomics(r, bodyEnd);
        }
      }
      top.pos = end;
    }
  } catch (e) {
    if (e instanceof DecodeError) return { error: `malformed WebAssembly binary: ${e.message}` };
    throw e;
  }
  return out;
}

/**
 * The checks of L4.17 on the bytes of the library. Returns { errors, info }: `errors` is a list of
 * messages (empty when everything passes), `info` has the raw and gzip sizes (for the run summary).
 */
export function checkWasm(bytes, { entrySymbol = DEFAULT_ENTRY_SYMBOL, budget } = {}) {
  const info = { rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length };
  const parsed = parseWasm(bytes);
  if (parsed.error) return { errors: [parsed.error], info };
  const errors = [];
  if (!parsed.dylink) errors.push('no "dylink.0" section: not an Emscripten side module (SIDE_MODULE)');
  if (parsed.imports.some((i) => i.shared) || parsed.memories.some((m) => m.shared)) {
    errors.push('shared memory: this is a threaded build (L4.17: no threads)');
  }
  if (parsed.atomicsAt >= 0) {
    errors.push(`atomics instruction at offset ${parsed.atomicsAt}: this is a threaded build (L4.17: no threads)`);
  }
  if (!parsed.exports.includes(entrySymbol)) errors.push(`the entry symbol "${entrySymbol}" is not exported`);
  if (budget !== undefined && bytes.length > budget) {
    errors.push(`size ${bytes.length} bytes exceeds the budget of ${budget} bytes (LD34)`);
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

/** The web entries of the .gdextension file (L4.17, LD27). Returns a list of error messages. */
export function checkGdextension(text, { path = WEB_LIBRARY_PATH } = {}) {
  const libraries = readLibraries(text);
  const errors = [];
  for (const key of WEB_KEYS) {
    if (!(key in libraries)) errors.push(`${key} is missing from [libraries]`);
    else if (libraries[key] !== path) errors.push(`${key} is "${libraries[key]}", expected "${path}"`);
  }
  for (const key of Object.keys(libraries)) {
    if (key.startsWith('web.') && key.split('.').includes('threads')) {
      errors.push(`${key}: no threaded web build is shipped (LD27)`);
    }
  }
  return errors;
}

/** WASM_BUDGET_BYTES from versions.env, or undefined. */
export function readBudget(versionsEnv) {
  const match = versionsEnv.match(/^WASM_BUDGET_BYTES=(\d+)\s*$/m);
  return match ? Number(match[1]) : undefined;
}

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
  const gdextensionPath = take('--gdextension');
  const budgetArg = take('--budget');
  const unknown = args.filter((a) => a.startsWith('--'));
  if (unknown.length > 0 || args.length > 1 || (args.length === 0 && gdextensionPath === undefined) ||
      gdextensionPath === '' || budgetArg === '' || (budgetArg !== undefined && !/^\d+$/.test(budgetArg))) {
    console.error('usage: check-wasm.mjs [<library.wasm>] [--gdextension <file>] [--budget <bytes>]');
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
      budget = readBudget(readFileSync(env, 'utf8'));
      // A missing or malformed budget must fail: otherwise the size check would silently switch off (L4.17).
      if (budget === undefined) failures.push(`${env}: no WASM_BUDGET_BYTES (a whole number of bytes): the size budget cannot be checked (LD34)`);
    }
    const bytes = read(args[0]);
    if (bytes !== undefined) {
      const { errors, info } = checkWasm(bytes, { entrySymbol, budget });
      console.log(`${args[0]}: raw ${format(info.rawBytes)}, gzip ${format(info.gzipBytes)}` +
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
