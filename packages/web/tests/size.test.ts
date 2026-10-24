// The JavaScript shipped to browsers, WebAssembly included, stays under 60 KB gzip (L4.2).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const dist = new URL('../dist/', import.meta.url).pathname;

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

describe('package size', () => {
  it('ships under 60 KB gzip', () => {
    const files = jsFiles(dist);
    expect(files.length).toBeGreaterThan(0);
    const total = files.reduce((sum, f) => sum + gzipSync(readFileSync(f), { level: 9 }).length, 0);
    console.log(`dist JS gzip: ${(total / 1024).toFixed(1)} KB`);
    expect(total).toBeLessThan(60 * 1024);
  });
});
