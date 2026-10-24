/**
 * Memoizes the render of the current input, so playback and export share the same
 * samples (R7.2). A new key object invalidates the cache.
 */
export function createBufferCache<K extends object, B>(render: (key: K) => Promise<B>) {
  let current: K | null = null;
  let pending: Promise<B> | null = null;

  return {
    get(key: K): Promise<B> {
      if (current !== key || !pending) {
        current = key;
        const result = render(key);
        pending = result;
        result.catch(() => {
          if (pending === result) pending = null;
        });
      }
      return pending;
    },
  };
}
