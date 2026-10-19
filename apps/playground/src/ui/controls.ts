import type { StyleId, Voice } from '../core/types.ts';
import { STYLE_LIST } from '../styles/index.ts';

export const MAX_LENGTH = 500;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const FORMAT: Record<keyof Voice, (v: number) => string> = {
  pitch: (v) => `${v > 0 ? '+' : ''}${v} st`,
  speed: (v) => `${v} c/s`,
  variation: (v) => v.toFixed(2),
};

/** DOM bindings for the inputs and buttons. Holds no app state. */
export function createControls(initialStyle: StyleId) {
  const text = $<HTMLTextAreaElement>('text');
  const counter = $('counter');
  const message = $('message');
  const play = $<HTMLButtonElement>('play');
  const exportButton = $<HTMLButtonElement>('export');
  const sliders = {
    pitch: $<HTMLInputElement>('pitch'),
    speed: $<HTMLInputElement>('speed'),
    variation: $<HTMLInputElement>('variation'),
  };

  $('style-options').replaceChildren(
    ...STYLE_LIST.map((style, i) => {
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
      input.checked = style.id === initialStyle;
      card.querySelector('.style-card__label')!.textContent = style.label;
      card.querySelector('.style-card__desc')!.textContent = style.description;
      card.querySelector('.style-card__ref')!.textContent = style.reference;
      return card;
    }),
  );

  const readVoice = (): Voice => ({
    pitch: Number(sliders.pitch.value),
    speed: Number(sliders.speed.value),
    variation: Number(sliders.variation.value),
  });

  const syncOutputs = () => {
    const voice = readVoice();
    for (const key of Object.keys(sliders) as (keyof Voice)[]) {
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
