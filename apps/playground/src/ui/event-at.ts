import type { MumbleEvent } from '@mumble-speech/web';

/** The event sounding at time `t`, or null between sounds (R6.3). Binary search on sorted events. */
export function eventAt(events: readonly MumbleEvent[], t: number): MumbleEvent | null {
  let lo = 0;
  let hi = events.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const e = events[mid];
    if (t < e.start) hi = mid - 1;
    else if (t >= e.start + e.duration) lo = mid + 1;
    else return e;
  }
  return null;
}
