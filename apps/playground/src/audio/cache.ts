import type { Timeline } from '../core/types.ts';

/**
 * Memoizes the synthesis of the current timeline, so playback and export share
 * the same samples (R7.2, D1). A new timeline object invalidates the cache.
 */
export function createBufferCache<B>(render: (timeline: Timeline) => Promise<B>) {
  let key: Timeline | null = null;
  let pending: Promise<B> | null = null;

  return {
    get(timeline: Timeline): Promise<B> {
      if (key !== timeline || !pending) {
        key = timeline;
        const current = render(timeline);
        pending = current;
        current.catch(() => {
          if (pending === current) pending = null;
        });
      }
      return pending;
    },
  };
}
