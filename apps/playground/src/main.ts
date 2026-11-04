import '@fontsource/pixelify-sans/400.css';
import './style.css';
import { encodeWav, init, render, timeline as buildTimeline, WebAudioPlayer, type Timeline, type Voice } from '@mumble-speech/web';
import { createBufferCache } from './audio/cache.ts';
import { createCopyLink, legacyCopy, shareLink } from './ui/copy-link.ts';
import { createControls } from './ui/controls.ts';
import { eventAt } from './ui/event-at.ts';
import { exportFilename } from './ui/filename.ts';
import { createUrlSync, parseSettings } from './ui/share-url.ts';
import { createVisualizer } from './ui/visualizer.ts';

/** WAV export rate (R7.1). */
const SAMPLE_RATE = 44_100;

/** One immutable snapshot of the inputs; a new object invalidates the audio cache. */
interface Line {
  text: string;
  voice: Voice;
  timeline: Timeline;
}

await init();

// App state: specs/playground/design.md §7.2
const initial = parseSettings(location.search); // before the controls exist (R9.4)
const controls = createControls(initial.settings);
const urlSync = createUrlSync({ history, location });
const visualizer = createVisualizer(document.getElementById('viz')!);
const player = new WebAudioPlayer();
const cache = createBufferCache(async (line: Line) => render(line.text, line.voice, SAMPLE_RATE).samples);

let line: Line;
let playback: 'idle' | 'rendering' | 'playing' = 'idle';
let error: string | undefined;
let frame = 0;

function refreshControls() {
  controls.update({ length: line.text.length, audible: line.timeline.events.length > 0, playback, error });
}

function stop() {
  player.stop();
  cancelAnimationFrame(frame);
  visualizer.setActive(null);
  playback = 'idle';
}

/** Any input change: stop, rebuild the timeline, redraw (R2.3, R4.5, R5.3). */
function onInputChange() {
  stop();
  error = undefined;
  const text = controls.text;
  const voice: Voice = { style: controls.style, ...controls.voice };
  line = { text, voice, timeline: buildTimeline(text, voice) };
  visualizer.render(text, line.timeline);
  refreshControls();
}

/**
 * Drives the highlight and the end of playback from the audio clock. The
 * `ended` event is not used: it fires when the audio is rendered, which can be
 * well before it is heard (D7).
 */
function highlight() {
  const position = player.position();
  if (position >= line.timeline.duration) {
    stop();
    refreshControls();
    return;
  }
  visualizer.setActive(eventAt(line.timeline.events, position)?.utf16Start ?? null);
  frame = requestAnimationFrame(highlight);
}

const copyLink = createCopyLink({
  link: () => {
    const settings = { text: controls.text, style: controls.style, ...controls.voice };
    urlSync.schedule(settings);
    urlSync.flush(); // address bar matches the copied link (R9.15)
    return shareLink(settings, location); // R9.14
  },
  clipboard: navigator.clipboard, // undefined outside secure contexts
  legacyCopy: (text) => legacyCopy(text, document, controls.copyButton),
  render: controls.showCopyFeedback,
});

controls.onChange(() => {
  copyLink.reset(); // R9.16, R9.17
  onInputChange();
  urlSync.schedule({ text: controls.text, style: controls.style, ...controls.voice }); // R9.2
});

controls.onCopyLink(() => void copyLink.press()); // never touches playback or settings (R9.20)

controls.onPlay(async () => {
  if (playback === 'playing') {
    stop();
    refreshControls();
    return;
  }
  player.unlock(); // synchronously inside the click, before any await (R8.4)
  const target = line;
  playback = 'rendering';
  refreshControls();
  try {
    const samples = await cache.get(target);
    if (target !== line || playback !== 'rendering') return; // input changed meanwhile
    await player.play(samples, SAMPLE_RATE);
    if (target !== line) return player.stop();
    playback = 'playing';
    frame = requestAnimationFrame(highlight);
  } catch (e) {
    playback = 'idle';
    error = `Could not play audio: ${e instanceof Error ? e.message : String(e)}`;
  }
  refreshControls();
});

controls.onExport(async () => {
  const style = controls.style;
  try {
    const wav = encodeWav(await cache.get(line), SAMPLE_RATE);
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename(style, new Date());
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    error = `Could not export audio: ${e instanceof Error ? e.message : String(e)}`;
    refreshControls();
  }
});

onInputChange();
if (initial.present) {
  urlSync.schedule(initial.settings);
  urlSync.flush(); // canonical URL on load, no history entry (R9.4)
}
