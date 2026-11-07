// Tests of the pure helpers of run-tests.mjs (specs/design.md §9.3.1, L4.15, L4.16, L5.2): the command line,
// the verdict of a run, the fatal console patterns, the launch options per browser and the static server.
// No browser and no Playwright needed (the browser run itself is the godot-web CI job).
// Run: node --test scripts/godot-web/run-tests.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  AUDIO_SUSPENDER, AUDIO_TRACKER, audioVerdict, initScripts, contentTypeFor, isFatalConsole, launchOptions, libraryFailures, parseArgs, serve, verdict,
} from './run-tests.mjs';

// The status and body of a request whose path is sent exactly as given (fetch would normalize `..`).
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    // agent: false, so no keep-alive socket holds server.close() open.
    request({ host: '127.0.0.1', port, path, method: 'GET', agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject).end();
  });
}

test('parseArgs reads the options and rejects bad input', () => {
  assert.deepEqual(parseArgs(['out', '--browser', 'firefox', '--audio', 'suspended', '--headed']).options, {
    dir: 'out', browser: 'firefox', audio: 'suspended', mode: 'tests', threads: false, isolationHeaders: false, headed: true, timeoutSeconds: 180,
  });
  assert.match(parseArgs(['out']).error, /--audio is required/);
  assert.match(parseArgs(['out', '--audio', 'loud']).error, /--audio must be/);
  assert.match(parseArgs(['--audio', 'running']).error, /missing <export dir>/);
  assert.match(parseArgs(['out', '--audio', 'running', '--browser', 'ie']).error, /--browser must be/);
});

test('parseArgs: the defaults are chromium, tests mode, 180 s, headless', () => {
  assert.deepEqual(parseArgs(['out', '--audio', 'running']).options, {
    dir: 'out', browser: 'chromium', audio: 'running', mode: 'tests', threads: false, isolationHeaders: false, headed: false, timeoutSeconds: 180,
  });
});

test('parseArgs: options may come before the directory', () => {
  assert.equal(parseArgs(['--audio', 'running', 'out']).options.dir, 'out');
});

test('parseArgs: --timeout is a whole number of seconds above zero', () => {
  assert.equal(parseArgs(['out', '--audio', 'running', '--timeout', '30']).options.timeoutSeconds, 30);
  for (const value of ['0', '1.5', '-5', 'abc', '']) {
    assert.match(parseArgs(['out', '--audio', 'running', '--timeout', value]).error, /--timeout needs a whole number/, `"${value}"`);
  }
  assert.equal(parseArgs(['out', '--audio', 'running', '--timeout']).error, '--timeout needs a value');
});

test('parseArgs: --mode is tests or example', () => {
  assert.equal(parseArgs(['out', '--audio', 'running', '--mode', 'example']).options.mode, 'example');
  assert.match(parseArgs(['out', '--audio', 'running', '--mode', 'demo']).error, /--mode must be one of tests, example/);
});

test('parseArgs: a missing value, an unknown option and an extra argument are errors', () => {
  assert.equal(parseArgs(['out', '--audio']).error, '--audio needs a value');
  assert.equal(parseArgs(['out', '--browser']).error, '--browser needs a value');
  assert.match(parseArgs(['out', '--audio', 'running', '--bogus']).error, /unknown option --bogus/);
  assert.match(parseArgs(['out', 'second', '--audio', 'running']).error, /unexpected argument second/);
  // A value is taken as given, even when it looks like an option.
  assert.match(parseArgs(['out', '--audio', '--headed']).error, /--audio must be one of running, suspended/);
});

test('parseArgs: each browser of the matrix is accepted', () => {
  for (const browser of ['chromium', 'firefox', 'webkit']) {
    assert.equal(parseArgs(['out', '--audio', 'suspended', '--browser', browser]).options.browser, browser);
  }
});

test('only matching console errors are fatal', () => {
  assert.equal(isFatalConsole('error', 'LinkError: WebAssembly.instantiate(): Import #0'), true);
  assert.equal(isFatalConsole('error', 'FAIL: say: finished is emitted'), true);
  assert.equal(isFatalConsole('error', 'ERROR: MumbleSpeaker.say: PitchOutOfRange'), false);
  assert.equal(isFatalConsole('warning', 'Aborted()'), false);
});

test('fatal patterns: an abort, a wasm failure, a script error, a GDExtension failure, an uncaught error', () => {
  for (const text of [
    'Aborted(native code called abort())',
    'abort(1) at Error',
    'CompileError: WebAssembly.compile(): invalid module',
    'RuntimeError: memory access out of bounds',
    'RuntimeError: unreachable',
    'GDExtension: failed to load mumble_speech',
    'SCRIPT ERROR: Parse Error: Unexpected token',
    'Uncaught TypeError: Cannot read properties of undefined',
    'FAIL: typewriter: finished is emitted',
  ]) {
    assert.equal(isFatalConsole('error', text), true, text);
  }
});

test('non-fatal console errors: a failed resource, a Godot error that is not a check, a FAIL not at the start', () => {
  for (const text of [
    'Failed to load resource: the server responded with a status of 404',
    'ERROR: Resource loading failed',
    'the test printed FAIL: late, not at the start',
  ]) {
    assert.equal(isFatalConsole('error', text), false, text);
  }
  assert.equal(isFatalConsole('log', 'LinkError: printed as log, not an error'), false);
});

test('audioVerdict needs an AudioContext in the expected state', () => {
  assert.equal(audioVerdict(['running'], 'running'), undefined);
  assert.match(audioVerdict(['running'], 'suspended'), /expected suspended/);
  assert.match(audioVerdict([], 'running'), /no AudioContext/);
});

test('audioVerdict: one context in the wrong state fails the run, even with others right', () => {
  assert.match(audioVerdict(['running', 'suspended'], 'running'), /AudioContext state is \[running, suspended\], expected running/);
  assert.equal(audioVerdict(['suspended', 'suspended'], 'suspended'), undefined);
  assert.match(audioVerdict(undefined, 'running'), /no AudioContext/);
});

test('audioVerdict: WebKit "interrupted" counts as suspended, never as running (LD31)', () => {
  assert.equal(audioVerdict(['interrupted'], 'suspended'), undefined);
  assert.equal(audioVerdict(['suspended', 'interrupted'], 'suspended'), undefined);
  assert.match(audioVerdict(['interrupted'], 'running'), /expected running/);
  assert.match(audioVerdict(['interrupted', 'running'], 'suspended'), /expected suspended/);
  assert.match(audioVerdict(['closed'], 'suspended'), /expected suspended/);
});

test('verdict passes a clean run and fails a failing one', () => {
  const good = {
    mode: 'tests', audio: 'running', report: { done: true, failures: 0, checks: 10, vectors: 30 },
    consoleLines: ['MUMBLE_WEB_TESTS PASS 10'], fatal: [], crossOriginIsolated: false, audioStates: ['running'], requests: [{ path: '/mumble_godot.wasm', status: 200 }],
  };
  assert.deepEqual(verdict(good), []);
  assert.ok(verdict({ ...good, crossOriginIsolated: true }).length > 0);
  assert.ok(verdict({ ...good, report: { ...good.report, failures: 2 } }).length > 0);
  assert.ok(verdict({ ...good, audioStates: ['suspended'] }).length > 0);
});

test('verdict (tests): each failure of the runner is its own message', () => {
  const clean = {
    mode: 'tests', audio: 'running', report: { done: true, failures: 0, checks: 10, vectors: 30 },
    consoleLines: ['MUMBLE_WEB_TESTS PASS 10'], fatal: [], crossOriginIsolated: false, audioStates: ['running'], requests: [{ path: '/mumble_godot.wasm', status: 200 }],
  };
  assert.deepEqual(verdict({ ...clean, report: undefined, consoleLines: [] }).sort(), [
    'no "MUMBLE_WEB_TESTS PASS" line in the page log',
    'the test runner did not report',
  ].sort());
  assert.deepEqual(verdict({ ...clean, report: { ...clean.report, done: false } }), ['the test runner did not report']);
  assert.deepEqual(verdict({ ...clean, report: { ...clean.report, failures: 1 } }), ['the test runner reports 1 failed check(s)']);
  assert.deepEqual(verdict({ ...clean, report: { ...clean.report, vectors: 0 } }), ['no conformance vector was checked']);
  assert.deepEqual(verdict({ ...clean, consoleLines: ['MUMBLE_WEB_TESTS PASS 10', 'MUMBLE_WEB_TESTS FAIL 1'] }),
    ['the page log has a "MUMBLE_WEB_TESTS FAIL" line']);
  assert.deepEqual(verdict({ ...clean, fatal: ['page error: boom'] }), ['fatal page message: page error: boom']);
  assert.deepEqual(verdict({ ...clean, crossOriginIsolated: true }),
    ['crossOriginIsolated is true, expected false (no COOP/COEP, L4.15)']);
  assert.deepEqual(verdict({ ...clean, requests: [{ path: '/mumble_godot.wasm', status: 404 }] }),
    ['request for /mumble_godot.wasm answered 404']);
});

test('verdict (example): the example must start and the test runner must not', () => {
  const example = {
    mode: 'example', audio: 'running', report: undefined,
    consoleLines: ['MUMBLE_EXAMPLE started'], fatal: [], crossOriginIsolated: false, audioStates: ['running'], requests: [{ path: '/mumble_godot.wasm', status: 200 }],
  };
  assert.deepEqual(verdict(example), []);
  assert.deepEqual(verdict({ ...example, consoleLines: [] }), ['the example scene did not start (no "MUMBLE_EXAMPLE started" line)']);
  assert.deepEqual(verdict({ ...example, report: { done: true, failures: 0, checks: 1, vectors: 1 } }),
    ['the test runner started instead of the example scene']);
  assert.deepEqual(verdict({ ...example, consoleLines: ['MUMBLE_EXAMPLE started', 'MUMBLE_WEB_TESTS start: Godot 4.3'] }),
    ['the test runner started instead of the example scene']);
});

test('launchOptions: chromium gets the software GL flags and the autoplay policy of the audio state', () => {
  const running = launchOptions('chromium', 'running', false);
  assert.equal(running.headless, true);
  assert.ok(running.args.includes('--use-gl=angle') && running.args.includes('--use-angle=swiftshader'));
  assert.ok(running.args.includes('--autoplay-policy=no-user-gesture-required'));
  assert.ok(!running.args.includes('--autoplay-policy=document-user-activation-required'));
  const suspended = launchOptions('chromium', 'suspended', false);
  assert.ok(suspended.args.includes('--autoplay-policy=document-user-activation-required'));
  assert.ok(!suspended.args.includes('--autoplay-policy=no-user-gesture-required'));
  assert.equal(launchOptions('chromium', 'running', true).headless, false);
});

test('launchOptions: firefox gets the autoplay preferences of the audio state, and no chromium flags', () => {
  const running = launchOptions('firefox', 'running', false);
  assert.deepEqual(running.firefoxUserPrefs, { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false });
  assert.equal(running.args, undefined);
  const suspended = launchOptions('firefox', 'suspended', false);
  assert.deepEqual(suspended.firefoxUserPrefs, { 'media.autoplay.default': 1, 'media.autoplay.block-webaudio': true });
});

test('launchOptions: webkit has no extra options beyond headless', () => {
  assert.deepEqual(launchOptions('webkit', 'running', false), { headless: true });
  assert.deepEqual(launchOptions('webkit', 'suspended', true), { headless: false });
});

test('the command line runs when invoked through a symlink (a silent pass would hide a failed run)', () => {
  const folder = mkdtempSync(join(tmpdir(), 'run-tests-link-'));
  try {
    const link = join(folder, 'run-tests-link.mjs');
    symlinkSync(join(dirname(fileURLToPath(import.meta.url)), 'run-tests.mjs'), link);
    const result = spawnSync(process.execPath, [link], { encoding: 'utf8' });
    assert.equal(result.status, 2, `status ${result.status}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /missing <export dir>/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('the server types .wasm and sends no cross-origin isolation headers', async () => {
  assert.equal(contentTypeFor('x/mumble_godot.wasm'), 'application/wasm');
  const dir = mkdtempSync(join(tmpdir(), 'serve-'));
  writeFileSync(join(dir, 'index.html'), '<p>hi</p>');
  const server = await serve(dir);
  try {
    const ok = await fetch(server.url);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('cross-origin-opener-policy'), null);
    assert.equal(ok.headers.get('cross-origin-embedder-policy'), null);
    assert.equal((await fetch(`${server.url}missing.wasm`)).status, 404);
    assert.equal((await fetch(`${server.url}..%2f..%2fetc/passwd`)).status, 404);
  } finally {
    await server.close();
  }
});

test('contentTypeFor: the extension is case-insensitive; unknown types are octet-stream', () => {
  assert.equal(contentTypeFor('MUMBLE.WASM'), 'application/wasm');
  assert.equal(contentTypeFor('index.HTML'), 'text/html; charset=utf-8');
  assert.equal(contentTypeFor('data.pck'), 'application/octet-stream');
  assert.equal(contentTypeFor('notes.xyz'), 'application/octet-stream');
  assert.equal(contentTypeFor('noextension'), 'application/octet-stream');
});

test('the server: files with their media type and length, queries ignored, percent-encoded names decoded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-files-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<p>home</p>');
    writeFileSync(join(dir, 'a b.txt'), 'spaced');
    const server = await serve(dir);
    try {
      const port = new URL(server.url).port;
      const home = await rawGet(port, '/');
      assert.equal(home.status, 200);
      assert.equal(home.headers['content-type'], 'text/html; charset=utf-8');
      assert.equal(home.headers['content-length'], String(Buffer.byteLength('<p>home</p>')));
      assert.equal((await rawGet(port, '/index.html?v=2')).status, 200);
      const spaced = await rawGet(port, '/a%20b.txt');
      assert.equal(spaced.status, 200);
      assert.equal(spaced.body, 'spaced');
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the server: a directory is not served (its index.html only at the root)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-dir-'));
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'index.html'), 'nested');
    const server = await serve(dir);
    try {
      const port = new URL(server.url).port;
      assert.equal((await rawGet(port, '/sub/')).status, 404);
      assert.equal((await rawGet(port, '/sub')).status, 404);
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the server: .. in the path cannot leave the served directory, nor reach a sibling with the same prefix', async () => {
  const base = mkdtempSync(join(tmpdir(), 'serve-base-'));
  const sibling = `${base}-evil`;
  try {
    writeFileSync(join(base, 'index.html'), 'inside');
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'secret.txt'), 'outside');
    const server = await serve(base);
    try {
      const port = new URL(server.url).port;
      assert.equal((await rawGet(port, '/../../../../../etc/passwd')).status, 404);
      assert.equal((await rawGet(port, `/../${basename(sibling)}/secret.txt`)).status, 404);
      assert.equal((await rawGet(port, '/%2e%2e/%2e%2e/%2e%2e/etc/passwd')).status, 404);
      assert.equal((await rawGet(port, `/%2e%2e/${basename(sibling)}/secret.txt`)).status, 404);
      assert.equal((await rawGet(port, '/%00')).status, 404, 'a NUL byte is not a file');
      assert.equal((await rawGet(port, '/')).status, 200, 'the server still serves after the rejected paths');
      assert.deepEqual(server.requests.map((r) => r.status).slice(0, 3), [404, 404, 404]);
    } finally {
      await server.close();
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(sibling, { recursive: true, force: true });
  }
});

test('the server: a malformed percent-encoded path is answered 400 and the server keeps running', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-bad-'));
  try {
    writeFileSync(join(dir, 'index.html'), 'ok');
    const server = await serve(dir);
    try {
      const port = new URL(server.url).port;
      assert.equal((await rawGet(port, '/%E0%A4%A')).status, 400);
      assert.equal((await rawGet(port, '/%')).status, 400);
      assert.equal((await rawGet(port, '/')).status, 200);
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the server: every request is recorded with its path and status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-log-'));
  try {
    writeFileSync(join(dir, 'index.html'), 'ok');
    const server = await serve(dir);
    try {
      const port = new URL(server.url).port;
      await rawGet(port, '/');
      await rawGet(port, '/favicon.ico');
      assert.deepEqual(server.requests, [
        { path: '/', status: 200 },
        { path: '/favicon.ico', status: 404 },
      ]);
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AUDIO_TRACKER is the page script that records the AudioContexts and whether one runs', () => {
  assert.match(AUDIO_TRACKER, /window\.mumbleAudioContexts = contexts/);
  assert.match(AUDIO_TRACKER, /window\.mumbleAudioRunning = \(\) => contexts\.some\(\(c\) => c\.state === 'running'\)/);
});

test('initScripts: the suspender is added, before the tracker, only for --audio suspended', () => {
  assert.deepEqual(initScripts('running'), [AUDIO_TRACKER]);
  assert.deepEqual(initScripts('suspended'), [AUDIO_SUSPENDER, AUDIO_TRACKER]);
  assert.match(AUDIO_SUSPENDER, /context\.suspend\(\)/);
  assert.match(AUDIO_SUSPENDER, /context\.resume = \(\) =>/);
  assert.match(AUDIO_TRACKER, /__mumbleSuspendAudio\(context\)/);
});

// --- --threads (L4.19, LD35, LD39) ------------------------------------------------------------------------

test('parseArgs: --threads turns the isolation headers on, --no-isolation-headers (with --threads only) off', () => {
  const on = parseArgs(['out', '--audio', 'running', '--threads']).options;
  assert.equal(on.threads, true);
  assert.equal(on.isolationHeaders, true);
  const off = parseArgs(['out', '--audio', 'running', '--threads', '--no-isolation-headers']).options;
  assert.equal(off.isolationHeaders, false);
  assert.match(parseArgs(['out', '--audio', 'running', '--no-isolation-headers']).error, /needs --threads/);
});

test('the server sends COOP and COEP on every response, errors included, when asked to', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-iso-'));
  writeFileSync(join(dir, 'index.html'), '<p>hi</p>');
  const server = await serve(dir, { isolationHeaders: true });
  try {
    for (const path of ['', 'missing.wasm']) {
      const res = await fetch(`${server.url}${path}`);
      assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin', path);
      assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp', path);
    }
  } finally {
    await server.close();
  }
});

test('libraryFailures: the threaded run needs the threaded library only, the other run the reverse', () => {
  const plain = [{ path: '/mumble_godot.wasm', status: 200 }];
  const threaded = [{ path: '/mumble_godot.threads.wasm', status: 200 }];
  assert.deepEqual(libraryFailures(threaded, true), []);
  assert.deepEqual(libraryFailures(plain, false), []);
  assert.equal(libraryFailures(plain, true).length, 2);
  assert.equal(libraryFailures(threaded, false).length, 2);
  assert.equal(libraryFailures([...plain, ...threaded], true).length, 1);
  assert.equal(libraryFailures([], false).length, 1);
});

test('verdict (--threads): isolation, the threads report (null passes) and the library request', () => {
  const clean = {
    mode: 'tests', audio: 'running', threads: true, report: { done: true, failures: 0, checks: 10, vectors: 30, threads: true },
    consoleLines: ['MUMBLE_WEB_TESTS PASS 10'], fatal: [], crossOriginIsolated: true, audioStates: ['running'],
    requests: [{ path: '/mumble_godot.threads.wasm', status: 200 }],
  };
  assert.deepEqual(verdict(clean), []);
  assert.deepEqual(verdict({ ...clean, report: { ...clean.report, threads: null } }), []);
  assert.deepEqual(verdict({ ...clean, crossOriginIsolated: false }), ['crossOriginIsolated is false, expected true (COOP/COEP sent, L4.19)']);
  assert.deepEqual(verdict({ ...clean, report: { ...clean.report, threads: false } }), ['the test runner reports threads false, expected true']);
  assert.equal(verdict({ ...clean, threads: false }).length > 0, true);
});

// --- --threads (L4.19, L4.20, LD35, LD39): the command line, the isolation headers, the verdict and the library rule ----
// Test phase of issue #34 (T4): each case names the requirement it covers.

const THREADS_LIB = '/mumble_godot.threads.wasm';
const PLAIN_LIB = '/mumble_godot.wasm';
const cleanPage = (threads, extra = {}) => ({
  mode: 'tests', audio: 'running', threads,
  report: { done: true, failures: 0, checks: 10, vectors: 30, threads },
  consoleLines: ['MUMBLE_WEB_TESTS PASS 10'], fatal: [], crossOriginIsolated: threads,
  audioStates: ['running'], requests: [{ path: threads ? THREADS_LIB : PLAIN_LIB, status: 200 }],
  ...extra,
});

test('parseArgs --threads (L4.19): the option may come anywhere, with the other options, and sets both flags', () => {
  const a = parseArgs(['--threads', 'out', '--audio', 'running']).options;
  assert.equal(a.threads, true);
  assert.equal(a.isolationHeaders, true);
  const b = parseArgs(['out', '--mode', 'example', '--audio', 'suspended', '--threads', '--timeout', '60', '--browser', 'firefox']).options;
  assert.deepEqual([b.threads, b.isolationHeaders, b.mode, b.audio, b.timeoutSeconds, b.browser], [true, true, 'example', 'suspended', 60, 'firefox']);
  // Without --threads: no isolation headers, no threads.
  const c = parseArgs(['out', '--audio', 'running']).options;
  assert.deepEqual([c.threads, c.isolationHeaders], [false, false]);
});

test('parseArgs --no-isolation-headers (L4.19 negative run): only with --threads, in either order, and it turns the headers off', () => {
  const a = parseArgs(['--no-isolation-headers', '--threads', 'out', '--audio', 'running']).options;
  assert.deepEqual([a.threads, a.isolationHeaders], [true, false]);
  const b = parseArgs(['out', '--audio', 'running', '--threads', '--no-isolation-headers']).options;
  assert.deepEqual([b.threads, b.isolationHeaders], [true, false]);
  assert.match(parseArgs(['out', '--audio', 'running', '--no-isolation-headers']).error, /--no-isolation-headers needs --threads/);
  assert.match(parseArgs(['--no-isolation-headers', 'out', '--audio', 'running']).error, /needs --threads/);
  // A value of --threads cannot be taken for the directory: it is an option.
  assert.equal(parseArgs(['--threads', '--audio', 'running']).error, 'missing <export dir>');
});

test('parseArgs --threads: a repeated option is accepted (the flags are boolean) and an extra directory is still an error', () => {
  assert.equal(parseArgs(['out', '--audio', 'running', '--threads', '--threads']).options.threads, true);
  assert.match(parseArgs(['out', 'second', '--audio', 'running', '--threads']).error, /unexpected argument second/);
});

test('the server adds COOP and COEP to every response, 200, 404 and 400, when isolation headers are on (L4.19)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-iso-all-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<p>hi</p>');
    const server = await serve(dir, { isolationHeaders: true });
    try {
      const port = new URL(server.url).port;
      for (const [path, status] of [['/', 200], ['/missing.wasm', 404], ['/%E0%A4%A', 400], ['/%', 400], ['/..%2f..%2fetc%2fpasswd', 404]]) {
        const res = await rawGet(port, path);
        assert.equal(res.status, status, path);
        assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin', `${path} COOP`);
        assert.equal(res.headers['cross-origin-embedder-policy'], 'require-corp', `${path} COEP`);
      }
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the server sends no isolation headers on 200, 404 and 400 without --threads (L4.15: the non-threaded run)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-noiso-all-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<p>hi</p>');
    const server = await serve(dir);
    try {
      const port = new URL(server.url).port;
      for (const [path, status] of [['/', 200], ['/missing.wasm', 404], ['/%', 400]]) {
        const res = await rawGet(port, path);
        assert.equal(res.status, status, path);
        assert.equal(res.headers['cross-origin-opener-policy'], undefined, `${path} COOP`);
        assert.equal(res.headers['cross-origin-embedder-policy'], undefined, `${path} COEP`);
      }
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the server records the path without its query, so a versioned library URL counts as the library (L4.19)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-query-'));
  try {
    mkdirSync(join(dir, 'x'));
    writeFileSync(join(dir, 'x', 'mumble_godot.threads.wasm'), 'lib');
    const server = await serve(dir, { isolationHeaders: true });
    try {
      const port = new URL(server.url).port;
      assert.equal((await rawGet(port, '/x/mumble_godot.threads.wasm?v=1')).status, 200);
      assert.deepEqual(server.requests, [{ path: '/x/mumble_godot.threads.wasm', status: 200 }]);
      assert.deepEqual(libraryFailures(server.requests, true), []);
    } finally {
      await server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the verdict matrix (L4.15, L4.19): isolation true or false, against threads on or off', () => {
  // Threads on: only isolated, threaded runs pass.
  assert.deepEqual(verdict(cleanPage(true)), []);
  assert.ok(verdict(cleanPage(true, { crossOriginIsolated: false })).some((f) => /crossOriginIsolated is false, expected true/.test(f)));
  // Threads off: only non-isolated runs pass.
  assert.deepEqual(verdict(cleanPage(false)), []);
  assert.ok(verdict(cleanPage(false, { crossOriginIsolated: true })).some((f) => /crossOriginIsolated is true, expected false/.test(f)));
  // The two mismatches of the matrix, each with the library rule as well.
  const threadsOnNoIsolation = verdict(cleanPage(true, { crossOriginIsolated: false }));
  assert.ok(threadsOnNoIsolation.length >= 1);
  const threadsOffIsolated = verdict(cleanPage(false, { crossOriginIsolated: true, requests: [{ path: PLAIN_LIB, status: 200 }] }));
  assert.deepEqual(threadsOffIsolated, ['crossOriginIsolated is true, expected false (no COOP/COEP, L4.15)']);
});

test('the verdict matrix holds in example mode too (L4.19): a threaded example needs isolation and the threaded library', () => {
  const example = (threads, crossOriginIsolated, path) => ({
    mode: 'example', audio: 'running', threads, report: undefined, consoleLines: ['MUMBLE_EXAMPLE started'], fatal: [],
    crossOriginIsolated, audioStates: ['running'], requests: [{ path, status: 200 }],
  });
  assert.deepEqual(verdict(example(true, true, THREADS_LIB)), []);
  assert.ok(verdict(example(true, false, THREADS_LIB)).some((f) => /expected true/.test(f)));
  assert.ok(verdict(example(true, true, PLAIN_LIB)).some((f) => /mumble_godot\.wasm was requested/.test(f)));
  assert.deepEqual(verdict(example(false, false, PLAIN_LIB)), []);
  assert.ok(verdict(example(false, true, PLAIN_LIB)).some((f) => /expected false/.test(f)));
  assert.ok(verdict(example(false, false, THREADS_LIB)).some((f) => /mumble_godot\.threads\.wasm was requested/.test(f)));
});

test('the page report of threads (L4.19, LD39): true, false, null and undefined against the mode', () => {
  // Threads on: true and the unknown (null, undefined) pass; false fails.
  assert.deepEqual(verdict(cleanPage(true, { report: { done: true, failures: 0, vectors: 1, threads: true } })), []);
  assert.deepEqual(verdict(cleanPage(true, { report: { done: true, failures: 0, vectors: 1, threads: null } })), []);
  assert.deepEqual(verdict(cleanPage(true, { report: { done: true, failures: 0, vectors: 1 } })), []);
  assert.deepEqual(verdict(cleanPage(true, { report: { done: true, failures: 0, vectors: 1, threads: false } })),
    ['the test runner reports threads false, expected true']);
  // Threads off: false, null and undefined pass; true fails.
  assert.deepEqual(verdict(cleanPage(false, { report: { done: true, failures: 0, vectors: 1, threads: false } })), []);
  assert.deepEqual(verdict(cleanPage(false, { report: { done: true, failures: 0, vectors: 1, threads: null } })), []);
  assert.deepEqual(verdict(cleanPage(false, { report: { done: true, failures: 0, vectors: 1 } })), []);
  assert.deepEqual(verdict(cleanPage(false, { report: { done: true, failures: 0, vectors: 1, threads: true }, crossOriginIsolated: false })),
    ['the test runner reports threads true, expected false']);
});

test('libraryFailures (L4.19, LD35): each library must be requested in its own mode, and the other must not be', () => {
  assert.deepEqual(libraryFailures([{ path: THREADS_LIB, status: 200 }], true), []);
  assert.deepEqual(libraryFailures([{ path: PLAIN_LIB, status: 200 }], false), []);
  // The threaded run without the threaded library: one message, naming the library and the mode.
  const noThreaded = libraryFailures([{ path: PLAIN_LIB, status: 200 }], true);
  assert.equal(noThreaded.length, 2);
  assert.match(noThreaded[0], /mumble_godot\.threads\.wasm was not requested \(Thread Support on/);
  assert.match(noThreaded[1], /mumble_godot\.wasm was requested, but this export must load mumble_godot\.threads\.wasm only/);
  // The non-threaded run with the threaded library requested too.
  assert.equal(libraryFailures([{ path: PLAIN_LIB, status: 200 }, { path: THREADS_LIB, status: 200 }], false).length, 1);
  assert.equal(libraryFailures([{ path: PLAIN_LIB, status: 200 }, { path: THREADS_LIB, status: 200 }], true).length, 1);
  assert.equal(libraryFailures([], true).length, 1);
  assert.equal(libraryFailures([], false).length, 1);
});

test('libraryFailures: a 404 on the library still counts as requested; the verdict then fails on the status (L4.19)', () => {
  // The library was asked for (the request is in the log): no "not requested" message, but the run fails on the 404.
  assert.deepEqual(libraryFailures([{ path: THREADS_LIB, status: 404 }], true), []);
  const failures = verdict(cleanPage(true, { requests: [{ path: THREADS_LIB, status: 404 }] }));
  assert.deepEqual(failures, [`request for ${THREADS_LIB} answered 404`]);
  // A 404 on the non-threaded library in a non-threaded run is the same.
  assert.deepEqual(verdict(cleanPage(false, { requests: [{ path: PLAIN_LIB, status: 404 }] })), [`request for ${PLAIN_LIB} answered 404`]);
});

test('libraryFailures matches the file name only, so names that end the same way do not count (L4.19)', () => {
  // A versioned library URL in a subfolder is the library.
  assert.deepEqual(libraryFailures([{ path: '/x/mumble_godot.threads.wasm', status: 200 }], true), []);
  assert.deepEqual(libraryFailures([{ path: '/deep/nest/mumble_godot.wasm', status: 200 }], false), []);
  // A file whose name ends with the library name, without the slash, is a different file.
  assert.equal(libraryFailures([{ path: '/notmumble_godot.wasm', status: 200 }], false).length, 1);
  assert.equal(libraryFailures([{ path: '/notmumble_godot.threads.wasm', status: 200 }], true).length, 1);
  assert.equal(libraryFailures([{ path: '/notmumble_godot.threads.wasm', status: 200 }, { path: PLAIN_LIB, status: 200 }], true).length, 2,
    'the look-alike does not satisfy the threaded run, and the plain library must not be there');
  // A look-alike next to the right library does not count as the other library being requested.
  assert.deepEqual(libraryFailures([{ path: THREADS_LIB, status: 200 }, { path: '/notmumble_godot.wasm', status: 200 }], true), []);
  assert.deepEqual(libraryFailures([{ path: PLAIN_LIB, status: 200 }, { path: '/notmumble_godot.threads.wasm', status: 200 }], false), []);
});

test('the example scene with --threads needs the same library and isolation as the test runner (L4.19)', () => {
  const example = { mode: 'example', audio: 'suspended', threads: true, report: undefined, consoleLines: ['MUMBLE_EXAMPLE started'],
    fatal: [], crossOriginIsolated: true, audioStates: ['suspended'], requests: [{ path: THREADS_LIB, status: 200 }] };
  assert.deepEqual(verdict(example), []);
  assert.ok(verdict({ ...example, requests: [] }).some((f) => /mumble_godot\.threads\.wasm was not requested/.test(f)));
  assert.ok(verdict({ ...example, consoleLines: [] }).some((f) => /example scene did not start/.test(f)));
});
