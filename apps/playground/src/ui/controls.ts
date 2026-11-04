import type { StyleId } from '@mumble-speech/web';
import type { CopyFeedback } from './copy-link.ts';
import { MAX_TEXT_LENGTH, SLIDER_LIMITS, type Settings } from './share-url.ts';
import { STYLE_CARDS } from './styles.ts';

/** Slider values; the style comes from the cards. */
export interface VoiceParams {
  pitch: number;
  speed: number;
  variation: number;
}

export const MAX_LENGTH = MAX_TEXT_LENGTH;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const FORMAT: Record<keyof VoiceParams, (v: number) => string> = {
  pitch: (v) => `${v > 0 ? '+' : ''}${v} st`,
  speed: (v) => `${v} c/s`,
  variation: (v) => v.toFixed(2),
};

/** DOM bindings for the inputs and buttons. Holds no app state. `initial` comes from the URL or the defaults (R9.4). */
export function createControls(initial: Settings) {
  const text = $<HTMLTextAreaElement>('text');
  const counter = $('counter');
  const message = $('message');
  const play = $<HTMLButtonElement>('play');
  const exportButton = $<HTMLButtonElement>('export');
  const copyButton = $<HTMLButtonElement>('copy-link');
  const copyStatus = $('copy-status');
  const copyFallback = $('copy-fallback');
  const copyUrl = $<HTMLInputElement>('copy-url');
  let announce = 0;
  const sliders = {
    pitch: $<HTMLInputElement>('pitch'),
    speed: $<HTMLInputElement>('speed'),
    variation: $<HTMLInputElement>('variation'),
  };

  text.value = initial.text;
  for (const key of Object.keys(sliders) as (keyof VoiceParams)[]) {
    const { min, max, step } = SLIDER_LIMITS[key];
    Object.assign(sliders[key], { min: String(min), max: String(max), step: String(step), value: String(initial[key]) });
  }

  $('style-options').replaceChildren(
    ...STYLE_CARDS.map((style, i) => {
      const card = document.createElement('label');
      card.className = 'style-card';
      card.innerHTML = `
        <input type="radio" name="style" />
        <span class="style-card__num" aria-hidden="true">${i + 1}</span>
        <span class="style-card__label"></span>
        <span class="style-card__desc"></span>
        <span class="style-card__ref"></span>`;
      const input = card.querySelector('input')!;
      input.value = style.id;
      input.checked = style.id === initial.style;
      card.querySelector('.style-card__label')!.textContent = style.label;
      card.querySelector('.style-card__desc')!.textContent = style.description;
      card.querySelector('.style-card__ref')!.textContent = style.reference;
      return card;
    }),
  );

  const readVoice = (): VoiceParams => ({
    pitch: Number(sliders.pitch.value),
    speed: Number(sliders.speed.value),
    variation: Number(sliders.variation.value),
  });

  const syncOutputs = () => {
    const voice = readVoice();
    for (const key of Object.keys(sliders) as (keyof VoiceParams)[]) {
      $(`${key}-out`).textContent = FORMAT[key](voice[key]);
    }
  };
  syncOutputs();

  return {
    get text() {
      return text.value;
    },
    get style() {
      return document.querySelector<HTMLInputElement>('input[name="style"]:checked')!.value as StyleId;
    },
    get voice() {
      return readVoice();
    },

    /** Calls `fn` whenever text, style or voice changes. */
    onChange(fn: () => void) {
      text.addEventListener('input', fn);
      document.querySelectorAll('input[name="style"]').forEach((el) => el.addEventListener('change', fn));
      for (const slider of Object.values(sliders)) {
        slider.addEventListener('input', () => {
          syncOutputs();
          fn();
        });
      }
    },
    onPlay(fn: () => void) {
      play.addEventListener('click', fn);
    },
    onExport(fn: () => void) {
      exportButton.addEventListener('click', fn);
    },
    onCopyLink(fn: () => void) {
      copyButton.addEventListener('click', fn);
    },
    get copyButton() {
      return copyButton;
    },

    /** Label, live region and fallback field for the Copy link button (R9.16, R9.17). */
    showCopyFeedback(feedback: CopyFeedback) {
      cancelAnimationFrame(announce);
      copyButton.textContent = feedback.kind === 'copied' ? 'Link copied' : 'Copy link';
      if (feedback.kind !== 'manual') copyFallback.hidden = true;
      if (feedback.kind === 'idle') {
        copyStatus.textContent = '';
      } else {
        // Clear first, set on the next frame: a live region whose text does not change is not re-announced.
        copyStatus.textContent = '';
        const message =
          feedback.kind === 'copied' ? 'Link copied' : 'Could not copy automatically. The link is selected below.';
        announce = requestAnimationFrame(() => {
          copyStatus.textContent = message;
        });
      }
      if (feedback.kind === 'manual') {
        copyFallback.hidden = false;
        copyUrl.value = feedback.link;
        copyUrl.focus();
        copyUrl.select();
      }
    },

    update(state: { length: number; audible: boolean; playback: 'idle' | 'rendering' | 'playing'; error?: string }) {
      counter.textContent = `${state.length}/${MAX_LENGTH}`;
      message.textContent =
        state.error ?? (state.audible ? '' : 'Type at least one letter, digit or symbol to hear something.');
      play.disabled = !state.audible || state.playback === 'rendering';
      exportButton.disabled = !state.audible;
      play.setAttribute('aria-pressed', String(state.playback === 'playing'));
      play.textContent =
        state.playback === 'playing' ? '■ Stop' : state.playback === 'rendering' ? 'Rendering…' : '▶ Play';
    },
  };
}
