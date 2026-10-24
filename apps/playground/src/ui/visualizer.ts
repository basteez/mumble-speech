import type { Timeline } from '@mumble-speech/web';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Letters with a dot under each sounding one, plus the playback highlight (R6.1–R6.3).
 * Cells are keyed by UTF-16 offset, which the library's events carry, so a different
 * Unicode version in the browser cannot shift dots onto the wrong letter.
 */
export function createVisualizer(root: HTMLElement) {
  let cells = new Map<number, HTMLElement>();
  let active: HTMLElement | null = null;

  return {
    render(text: string, timeline: Timeline) {
      active = null;
      cells = new Map();
      const dots = new Map(timeline.events.map((e) => [e.utf16Start, e.dot]));
      const children: HTMLElement[] = [];
      let word: HTMLElement | null = null;

      for (const { segment, index } of segmenter.segment(text)) {
        const cell = document.createElement('span');
        cell.className = 'tok';
        cells.set(index, cell);
        const isBreak = segment.includes('\n');
        const isSpace = !isBreak && /^\s+$/u.test(segment);

        if (isBreak) {
          cell.classList.add('tok--break');
        } else {
          const char = document.createElement('span');
          char.textContent = isSpace ? '' : segment;
          cell.append(char);
          const dot = dots.get(index);
          if (dot) {
            cell.classList.add('tok--sound');
            const i = document.createElement('i');
            i.className = `dot dot--${dot.size}`;
            i.style.setProperty('--dot-color', dot.color);
            cell.append(i);
          } else if (isSpace) {
            cell.classList.add('tok--space');
          }
        }

        // Group consecutive non-space graphemes so lines wrap between words.
        if (isBreak || isSpace) {
          word = null;
          children.push(cell);
        } else {
          if (!word) {
            word = document.createElement('span');
            word.className = 'word';
            children.push(word);
          }
          word.append(cell);
        }
      }
      root.replaceChildren(...children);
    },

    /** Highlights the grapheme starting at `utf16Start`, or nothing. */
    setActive(utf16Start: number | null) {
      const next = utf16Start === null ? null : (cells.get(utf16Start) ?? null);
      if (next === active) return;
      active?.removeAttribute('data-active');
      next?.setAttribute('data-active', '');
      active = next;
    },
  };
}
