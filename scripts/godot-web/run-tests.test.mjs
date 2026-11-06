// Smoke tests of the pure helpers of run-tests.mjs (no browser, no Playwright needed).
// Run: node --test scripts/godot-web/run-tests.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { audioVerdict, contentTypeFor, isFatalConsole, parseArgs, serve, verdict } from './run-tests.mjs';

test('parseArgs reads the options and rejects bad input', () => {
  assert.deepEqual(parseArgs(['out', '--browser', 'firefox', '--audio', 'suspended', '--headed']).options, {
    dir: 'out', browser: 'firefox', audio: 'suspended', mode: 'tests', headed: true, timeoutSeconds: 180,
  });
  assert.match(parseArgs(['out']).error, /--audio is required/);
  assert.match(parseArgs(['out', '--audio', 'loud']).error, /--audio must be/);
  assert.match(parseArgs(['--audio', 'running']).error, /missing <export dir>/);
  assert.match(parseArgs(['out', '--audio', 'running', '--browser', 'ie']).error, /--browser must be/);
});

test('only matching console errors are fatal', () => {
  assert.equal(isFatalConsole('error', 'LinkError: WebAssembly.instantiate(): Import #0'), true);
  assert.equal(isFatalConsole('error', 'FAIL: say: finished is emitted'), true);
  assert.equal(isFatalConsole('error', 'ERROR: MumbleSpeaker.say: PitchOutOfRange'), false);
  assert.equal(isFatalConsole('warning', 'Aborted()'), false);
});

test('audioVerdict needs an AudioContext in the expected state', () => {
  assert.equal(audioVerdict(['running'], 'running'), undefined);
  assert.match(audioVerdict(['running'], 'suspended'), /expected suspended/);
  assert.match(audioVerdict([], 'running'), /no AudioContext/);
});

test('verdict passes a clean run and fails a failing one', () => {
  const good = {
    mode: 'tests', audio: 'running', report: { done: true, failures: 0, checks: 10, vectors: 30 },
    consoleLines: ['MUMBLE_WEB_TESTS PASS 10'], fatal: [], crossOriginIsolated: false, audioStates: ['running'], requests: [],
  };
  assert.deepEqual(verdict(good), []);
  assert.ok(verdict({ ...good, crossOriginIsolated: true }).length > 0);
  assert.ok(verdict({ ...good, report: { ...good.report, failures: 2 } }).length > 0);
  assert.ok(verdict({ ...good, audioStates: ['suspended'] }).length > 0);
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
