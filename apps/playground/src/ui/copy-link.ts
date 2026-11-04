import { serializeSettings, type Settings } from './share-url.ts';

/** What the button, the live region and the fallback field show (design §7.7). */
export type CopyFeedback =
  | { kind: 'idle' }
  | { kind: 'copied' }
  | { kind: 'manual'; link: string };

/**
 * Absolute link for `settings`: origin, path, canonical query (keeping the
 * parameters the playground does not own) and fragment (R9.14, D15).
 */
export function shareLink(
  settings: Settings,
  location: Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'>,
): string {
  return location.origin + location.pathname + serializeSettings(settings, location.search) + location.hash;
}

/**
 * Copy link logic with injected clipboard, fallback and view (R9.14–R9.18,
 * R9.20, D16). `press` never rejects and logs nothing.
 */
export function createCopyLink(deps: {
  link(): string;
  clipboard: Pick<Clipboard, 'writeText'> | undefined;
  legacyCopy(text: string): boolean;
  render(feedback: CopyFeedback): void;
  revertMs?: number;
}) {
  const { clipboard, render, revertMs = 2000 } = deps;
  let counter = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancelTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function safeRender(feedback: CopyFeedback) {
    try {
      render(feedback);
    } catch {
      // The view must never break the button (R9.18).
    }
  }

  function legacy(text: string): boolean {
    try {
      return deps.legacyCopy(text) === true;
    } catch {
      return false;
    }
  }

  return {
    async press(): Promise<void> {
      try {
        const seq = ++counter;
        const text = deps.link();
        let copied = false;
        if (clipboard) {
          try {
            // Synchronously in the click handler, before any await (user gesture).
            await clipboard.writeText(text);
            copied = true;
          } catch {
            copied = false;
          }
        }
        // A later press or a settings change owns the clipboard and the feedback: a stale
        // press must not copy its link through the fallback nor render (R9.16).
        if (seq !== counter) return;
        if (!copied) copied = legacy(text);
        cancelTimer();
        if (copied) {
          safeRender({ kind: 'copied' });
          timer = setTimeout(() => {
            timer = undefined;
            safeRender({ kind: 'idle' });
          }, revertMs);
        } else {
          safeRender({ kind: 'manual', link: text });
        }
      } catch {
        // R9.18: nothing escapes.
      }
    },
    /** A setting changed: idle now, cancel the timer (R9.16, R9.17). */
    reset() {
      counter++; // an in-flight press must not render after a settings change
      cancelTimer();
      safeRender({ kind: 'idle' });
    },
  };
}

/**
 * Off-screen read-only textarea + `execCommand('copy')`. Removes the textarea
 * and returns the focus to `returnFocus` (R9.17, R9.19). Never throws: any
 * exception counts as a failed copy.
 */
export function legacyCopy(text: string, doc: Document, returnFocus: HTMLElement): boolean {
  const area = doc.createElement('textarea');
  try {
    area.value = text;
    area.readOnly = true;
    area.setAttribute('aria-hidden', 'true');
    area.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;';
    doc.body.append(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    return doc.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    returnFocus.focus();
  }
}
