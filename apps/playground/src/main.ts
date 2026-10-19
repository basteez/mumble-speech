import '@fontsource/pixelify-sans/400.css';
import './style.css';
import { createBufferCache } from './audio/cache.ts';
import { Player } from './audio/player.ts';
import { SAMPLE_RATE, synthesize } from './audio/synth.ts';
import { encodeWav } from './audio/wav.ts';
import { buildTimeline, eventAt } from './core/timeline.ts';
import { hasAudibleTokens } from './core/tokenize.ts';
import type { Timeline } from './core/types.ts';
import { DEFAULT_STYLE, STYLES } from './styles/index.ts';
import { createControls } from './ui/controls.ts';
import { exportFilename } from './ui/filename.ts';
import { createVisualizer } from './ui/visualizer.ts';

// App state: specs/design.md §7.2
const controls = createControls(DEFAULT_STYLE);
const visualizer = createVisualizer(document.getElementById('viz')!);
const player = new Player();
const cache = createBufferCache(async (t: Timeline) => synthesize(t));

let timeline: Timeline;
let playback: 'idle' | 'rendering' | 'playing' = 'idle';
let error: string | undefined;
let frame = 0;

function refreshControls() {
  controls.update({ length: controls.text.length, audible: hasAudibleTokens(timeline.tokens), playback, error });
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
  timeline = buildTimeline(controls.text, STYLES[controls.style], controls.voice);
  visualizer.render(timeline);
  refreshControls();
}

/**
 * Drives the highlight and the end of playback from the audio clock. The
 * `ended` event is not used: it fires when the audio is rendered, which can be
 * well before it is heard (D7).
 */
function highlight() {
  const position = player.position();
  if (position >= timeline.duration) {
    stop();
    refreshControls();
    return;
  }
  visualizer.setActive(eventAt(timeline.events, position)?.tokenIndex ?? null);
  frame = requestAnimationFrame(highlight);
}

controls.onChange(onInputChange);

controls.onPlay(async () => {
  if (playback === 'playing') {
    stop();
    refreshControls();
    return;
  }
  player.unlock(); // synchronously inside the click, before any await (R8.4)
  const target = timeline;
  playback = 'rendering';
  refreshControls();
  try {
    const samples = await cache.get(target);
    if (target !== timeline || playback !== 'rendering') return; // input changed meanwhile
    await player.play(samples, SAMPLE_RATE);
    if (target !== timeline) return player.stop();
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
    const wav = encodeWav(await cache.get(timeline), SAMPLE_RATE);
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
