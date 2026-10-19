import type { StyleId } from '../core/types.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** `mumble-<style>-<YYYYMMDD-HHmmss>.wav`, in local time (R7.3). */
export function exportFilename(style: StyleId, date: Date): string {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `mumble-${style}-${day}-${time}.wav`;
}
