/** Strips diacritics and lowercases (R1.4): `è` → `e`, `Ñ` → `n`. */
export function normalize(char: string): string {
  return char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
