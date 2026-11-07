// Runs a Godot web export in a browser and checks the result (specs/design.md §9.3.1, L4.15-L4.17,
// L5.2, LD31): serves the export directory WITHOUT cross-origin isolation headers, opens it with
// Playwright and waits for the test runner (tests/web/runner.gd) to report.
//
// Usage: node run-tests.mjs <export dir> --browser chromium|firefox|webkit --audio running|suspended
//          [--mode tests|example] [--headed] [--timeout <seconds>]
//   tests    (default) the "Web (tests)" export: fails unless the page reports `MUMBLE_WEB_TESTS PASS`.
//   example  the "Web" export: fails unless the example scene starts (`MUMBLE_EXAMPLE started`) and stays
//            error-free for a few seconds; the test runner must NOT be running (the main scene is right).
//   Both fail unless crossOriginIsolated is false, the page logs no fatal error, and every AudioContext
//   is in the state of --audio when the run ends (a silent pass is not possible).
// The pure helpers are exported (tested by run-tests.test.mjs); the command line is a thin wrapper.
import { createReadStream, existsSync, realpathSync, statSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BROWSERS = ['chromium', 'firefox', 'webkit'];
export const AUDIO_STATES = ['running', 'suspended'];
export const MODES = ['tests', 'example'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.pck': 'application/octet-stream',
};

/** Media type of a file by extension (`application/wasm` for .wasm: streaming compilation needs it). */
export function contentTypeFor(file) {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Parses the command line. Returns { options } or { error }.
 * @param {string[]} argv arguments after the script name
 */
export function parseArgs(argv) {
  const options = { dir: undefined, browser: 'chromium', audio: undefined, mode: 'tests', headed: false, timeoutSeconds: 180 };
  const rest = argv.slice();
  while (rest.length > 0) {
    const arg = rest.shift();
    if (arg === '--headed') options.headed = true;
    else if (arg === '--browser' || arg === '--audio' || arg === '--mode' || arg === '--timeout') {
      const value = rest.shift();
      if (value === undefined) return { error: `${arg} needs a value` };
      if (arg === '--browser') options.browser = value;
      else if (arg === '--audio') options.audio = value;
      else if (arg === '--mode') options.mode = value;
      else {
        if (!/^[1-9]\d*$/.test(value)) return { error: `--timeout needs a whole number of seconds, got "${value}"` };
        options.timeoutSeconds = Number(value);
      }
    } else if (arg.startsWith('--')) return { error: `unknown option ${arg}` };
    else if (options.dir === undefined) options.dir = arg;
    else return { error: `unexpected argument ${arg}` };
  }
  if (options.dir === undefined) return { error: 'missing <export dir>' };
  if (!BROWSERS.includes(options.browser)) return { error: `--browser must be one of ${BROWSERS.join(', ')}` };
  if (options.audio === undefined) return { error: `--audio is required: ${AUDIO_STATES.join(' or ')}` };
  if (!AUDIO_STATES.includes(options.audio)) return { error: `--audio must be one of ${AUDIO_STATES.join(', ')}` };
  if (!MODES.includes(options.mode)) return { error: `--mode must be one of ${MODES.join(', ')}` };
  return { options };
}

/**
 * Serves a directory over HTTP on 127.0.0.1, with correct media types and, on purpose, NO
 * Cross-Origin-Opener-Policy or Cross-Origin-Embedder-Policy headers (L4.15). Resolves to
 * { url, close, requests } where `requests` records every request path and status.
 */
export function serve(dir) {
  const base = resolve(dir);
  const requests = [];
  const server = createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch {
      // A malformed escape (%E0, a lone %) is not a path: answer it, do not let the handler throw.
      requests.push({ path: req.url ?? '/', status: 400 });
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad request');
      return;
    }
    let file = normalize(join(base, pathname === '/' ? 'index.html' : pathname));
    const inside = file === base || file.startsWith(base + sep);
    if (!inside || !existsSync(file) || !statSync(file).isFile()) {
      requests.push({ path: pathname, status: 404 });
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    requests.push({ path: pathname, status: 200 });
    res.writeHead(200, {
      'Content-Type': contentTypeFor(file),
      'Content-Length': statSync(file).size,
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolvePromise, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolvePromise({
        url: `http://127.0.0.1:${port}/`,
        requests,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

// Console errors that mean the export is broken: a library that did not link or load, an engine
// abort, a script error, or a failed check of the runner. Other `error` lines are logged, not fatal:
// the suite exercises error paths on purpose (invalid voices print "ERROR: ...").
const FATAL = /Aborted|abort\(|LinkError|CompileError|RuntimeError|unreachable|GDExtension|SCRIPT ERROR|Uncaught|^FAIL:/;

/** Whether a console message of the page is fatal: an `error` that matches FATAL. */
export function isFatalConsole(type, text) {
  return type === 'error' && FATAL.test(text);
}

/**
 * The verdict on the AudioContext states recorded by the page, for `--audio running|suspended`:
 * at least one context must exist and every one must be in the expected state. Returns an error
 * message or undefined. WebKit reports `interrupted` for a context that is not playing because the
 * system or the page has not allowed it; for `--audio suspended` it counts as suspended (not running).
 */
export function audioVerdict(states, expected) {
  if (!Array.isArray(states) || states.length === 0) return 'the page created no AudioContext';
  const matches = (s) => s === expected || (expected === 'suspended' && s === 'interrupted');
  const wrong = states.filter((s) => !matches(s));
  if (wrong.length > 0) return `AudioContext state is [${states.join(', ')}], expected ${expected} (--audio ${expected})`;
  return undefined;
}

/**
 * The verdict on a finished run, from what the page reported. Returns a list of failure messages.
 * @param {object} r
 * @param {string} r.mode
 * @param {string} r.audio                     expected AudioContext state
 * @param {object|undefined} r.report          window.mumbleWebTests ({ done, failures, checks, vectors, log })
 * @param {string[]} r.consoleLines            every console line of the page
 * @param {string[]} r.fatal                   fatal console lines and page errors
 * @param {boolean} r.crossOriginIsolated
 * @param {string[]} r.audioStates
 * @param {{path: string, status: number}[]} r.requests
 */
export function verdict({ mode, audio, report, consoleLines, fatal, crossOriginIsolated, audioStates, requests }) {
  const failures = [];
  if (mode === 'tests') {
    if (!report || report.done !== true) failures.push('the test runner did not report');
    else {
      if (report.failures !== 0) failures.push(`the test runner reports ${report.failures} failed check(s)`);
      if (!(report.vectors > 0)) failures.push('no conformance vector was checked');
    }
    if (!consoleLines.some((l) => /MUMBLE_WEB_TESTS PASS \d+/.test(l))) failures.push('no "MUMBLE_WEB_TESTS PASS" line in the page log');
    if (consoleLines.some((l) => /MUMBLE_WEB_TESTS FAIL/.test(l))) failures.push('the page log has a "MUMBLE_WEB_TESTS FAIL" line');
  } else {
    if (!consoleLines.some((l) => /MUMBLE_EXAMPLE started/.test(l))) failures.push('the example scene did not start (no "MUMBLE_EXAMPLE started" line)');
    if (report || consoleLines.some((l) => /MUMBLE_WEB_TESTS/.test(l))) failures.push('the test runner started instead of the example scene');
  }
  if (crossOriginIsolated !== false) failures.push(`crossOriginIsolated is ${crossOriginIsolated}, expected false (no COOP/COEP, L4.15)`);
  for (const line of fatal) failures.push(`fatal page message: ${line}`);
  const missing = requests.filter((r) => r.status >= 400);
  for (const r of missing) failures.push(`request for ${r.path} answered ${r.status}`);
  const audioFailure = audioVerdict(audioStates, audio);
  if (audioFailure) failures.push(audioFailure);
  return failures;
}

// Recorded by an init script in the page: every AudioContext the page creates, and whether one runs.
// Godot's test runner reads window.mumbleAudioRunning to know whether the Stream mode check can run.
export const AUDIO_TRACKER = `(() => {
  const contexts = [];
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Original = window[name];
    if (!Original) continue;
    window[name] = new Proxy(Original, {
      construct(target, args, newTarget) {
        const context = Reflect.construct(target, args, newTarget);
        contexts.push(context);
        if (window.__mumbleSuspendAudio) window.__mumbleSuspendAudio(context);
        return context;
      },
    });
  }
  window.mumbleAudioContexts = contexts;
  window.mumbleAudioRunning = () => contexts.some((c) => c.state === 'running');
})();`;

// `--audio suspended`: emulates a page that never got a user gesture, the same in every browser (the
// autoplay flags and prefs of launchOptions are only a first line: they do not keep the context
// suspended under Playwright). Every AudioContext is suspended right away and resume() is a no-op
// that resolves without resuming; logged once so it is visible.
export const AUDIO_SUSPENDER = `(() => {
  let logged = false;
  window.__mumbleSuspendAudio = (context) => {
    context.suspend().catch(() => {});
    context.resume = () => {
      if (!logged) {
        logged = true;
        console.log('MUMBLE_WEB_TESTS audio suspended: AudioContext.resume() is a no-op (--audio suspended)');
      }
      return Promise.resolve();
    };
  };
})();`;

/** The init scripts of the page for `--audio running|suspended`: the suspender must come first. */
export function initScripts(audio) {
  return audio === 'suspended' ? [AUDIO_SUSPENDER, AUDIO_TRACKER] : [AUDIO_TRACKER];
}

/** Launch options of a browser for the audio and WebGL setup of CI (specs/design.md §9.3.1). */
export function launchOptions(browser, audio, headed) {
  const options = { headless: !headed };
  if (browser === 'chromium') {
    options.args = [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      audio === 'running' ? '--autoplay-policy=no-user-gesture-required' : '--autoplay-policy=document-user-activation-required',
    ];
  } else if (browser === 'firefox') {
    const running = audio === 'running';
    options.firefoxUserPrefs = { 'media.autoplay.default': running ? 0 : 1, 'media.autoplay.block-webaudio': !running };
  }
  return options;
}

function summary(lines) {
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

async function run(options) {
  const playwright = await import('playwright');
  const { dir, browser: name, audio, mode, headed, timeoutSeconds } = options;
  const server = await serve(dir);
  const browser = await playwright[name].launch(launchOptions(name, audio, headed));
  const consoleLines = [];
  const fatal = [];
  try {
    const page = await browser.newPage();
    for (const script of initScripts(audio)) await page.addInitScript(script);
    page.on('console', (message) => {
      const text = message.text();
      consoleLines.push(text);
      console.log(`[page ${message.type()}] ${text}`);
      if (isFatalConsole(message.type(), text)) fatal.push(text);
    });
    page.on('pageerror', (error) => {
      fatal.push(`page error: ${error.message}`);
      console.log(`[page error] ${error.message}`);
    });
    await page.goto(server.url, { waitUntil: 'load' });
    const timeout = timeoutSeconds * 1000;
    let waitFailure;
    try {
      if (mode === 'tests') {
        await page.waitForFunction(() => window.mumbleWebTests && window.mumbleWebTests.done === true, null, { timeout, polling: 500 });
      } else {
        const started = Date.now();
        while (!consoleLines.some((l) => /MUMBLE_EXAMPLE started/.test(l))) {
          if (Date.now() - started > timeout) throw new Error('timeout');
          await page.waitForTimeout(500);
        }
        await page.waitForTimeout(5000); // the example runs a few seconds: its first line is typed
      }
    } catch (e) {
      waitFailure = `the page did not finish within ${timeoutSeconds} s (${e.message.split('\n')[0]})`;
    }
    const crossOriginIsolated = await page.evaluate(() => window.crossOriginIsolated);
    const audioStates = await page.evaluate(() => (window.mumbleAudioContexts ?? []).map((c) => c.state));
    const report = await page.evaluate(() => (window.mumbleWebTests ? { ...window.mumbleWebTests } : undefined));
    const failures = verdict({ mode, audio, report, consoleLines, fatal, crossOriginIsolated, audioStates, requests: server.requests });
    if (waitFailure) failures.unshift(waitFailure);
    const timings = consoleLines.filter((l) => l.startsWith('MUMBLE_WEB_TIMING'));
    summary([
      `### Godot web export in ${name} (${mode}, audio ${audio})`,
      '',
      `- Godot: ${consoleLines.find((l) => l.startsWith('MUMBLE_WEB_TESTS start')) ?? 'n/a'}`,
      `- browser version: ${browser.version()}`,
      `- AudioContext states: ${audioStates.join(', ') || 'none'}; crossOriginIsolated: ${crossOriginIsolated}`,
      ...(mode === 'tests' ? [`- checks: ${report?.checks ?? 'n/a'}; conformance vectors checked: ${report?.vectors ?? 'n/a'}; failures: ${report?.failures ?? 'n/a'}`] : []),
      ...timings.map((t) => `- ${t}`),
      `- result: ${failures.length === 0 ? 'PASS' : 'FAIL'}`,
    ]);
    for (const f of failures) console.error(`FAIL ${f}`);
    return failures.length === 0 ? 0 : 1;
  } finally {
    await browser.close();
    await server.close();
  }
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`${parsed.error}\nusage: run-tests.mjs <export dir> --browser chromium|firefox|webkit --audio running|suspended [--mode tests|example] [--headed] [--timeout <seconds>]`);
    return 2;
  }
  if (!existsSync(join(parsed.options.dir, 'index.html'))) {
    console.error(`FAIL ${parsed.options.dir} has no index.html`);
    return 1;
  }
  return run(parsed.options);
}

// realpath: a symlinked entry point (a mktemp folder on macOS) must still run, or the check would pass silently.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
