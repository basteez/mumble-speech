import type { Timeline } from '../core/types.ts';

/** Letters with a dot under each sounding one, plus the playback highlight (R6.1–R6.3). */
export function createVisualizer(root: HTMLElement) {
  let cells: HTMLElement[] = [];
  let active: HTMLElement | null = null;

  return {
    render(timeline: Timeline) {
      active = null;
      const dots = new Map(timeline.events.map((e) => [e.tokenIndex, e.dot]));
      cells = timeline.tokens.map((token) => {
        const cell = document.createElement('span');
        cell.className = 'tok';
        if (token.char.includes('\n')) {
          cell.classList.add('tok--break');
          return cell;
        }
        const char = document.createElement('span');
        char.textContent = token.kind === 'space' ? '' : token.char;
        cell.append(char);
        const dot = dots.get(token.index);
        if (dot) {
          cell.classList.add('tok--sound');
          const i = document.createElement('i');
          i.className = `dot dot--${dot.size}`;
          i.style.setProperty('--dot-color', dot.color);
          cell.append(i);
        } else if (token.kind === 'space') {
          cell.classList.add('tok--space');
        }
        return cell;
      });
      // Group consecutive non-space tokens so lines wrap between words.
      const children: HTMLElement[] = [];
      let word: HTMLElement | null = null;
      timeline.tokens.forEach((token, i) => {
        if (token.kind === 'space' || token.char.includes('\n')) {
          word = null;
          children.push(cells[i]);
          return;
        }
        if (!word) {
          word = document.createElement('span');
          word.className = 'word';
          children.push(word);
        }
        word.append(cells[i]);
      });
      root.replaceChildren(...children);
    },

    setActive(tokenIndex: number | null) {
      const next = tokenIndex === null ? null : (cells[tokenIndex] ?? null);
      if (next === active) return;
      active?.removeAttribute('data-active');
      next?.setAttribute('data-active', '');
      active = next;
    },
  };
}
