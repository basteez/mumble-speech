// Shareable URL (R9): parsing and canonical serialization. Pure functions, no DOM.
import type { StyleId } from '@mumble-speech/web';
import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import {
  DEFAULT_SETTINGS,
  MAX_TEXT_LENGTH,
  SLIDER_LIMITS,
  parseSettings,
  serializeSettings,
  type Settings,
} from '../src/ui/share-url.ts';

const CANONICAL_DEFAULTS = '?text=Hello&style=beep&pitch=0&speed=15&variation=0';

/** Builds a query string the way a browser would (encoded), from plain pairs. */
const qs = (pairs: Record<string, string>) => `?${new URLSearchParams(pairs)}`;

const withSettings = (overrides: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });

/** Parse the string, check it came back with no owned values changed, return the settings. */
const parse = (search: string) => parseSettings(search).settings;

const STYLES: StyleId[] = ['beep', 'grunt', 'alphabet'];

describe('round trip (R9.1, R9.10)', () => {
  const combos: Settings[] = [];
  for (const style of STYLES) {
    for (const pitch of [-12, -3, 0, 1, 12]) {
      for (const speed of [5, 15, 30]) {
        for (const variation of [0, 0.05, 0.95, 1]) {
          combos.push({ text: 'Ciao 👋', style, pitch, speed, variation });
        }
      }
    }
  }

  it.each(combos.map((s) => [JSON.stringify(s), s] as const))('round-trips %s', (_label, s) => {
    const { settings, present } = parseSettings(serializeSettings(s, ''));
    expect(settings).toEqual(s);
    expect(present).toBe(true);
  });

  it('round-trips the defaults', () => {
    expect(parseSettings(serializeSettings(DEFAULT_SETTINGS, ''))).toEqual({ settings: DEFAULT_SETTINGS, present: true });
  });

  it('a canonical string is a fixed point of parse then serialize', () => {
    const canonical = serializeSettings(withSettings({ text: 'a b', pitch: -3, variation: 0.25 }), '');
    expect(serializeSettings(parse(canonical), canonical)).toBe(canonical);
  });
});

describe('canonical form (R9.10, D12)', () => {
  it('defaults serialize to the fixed string', () => {
    expect(serializeSettings(DEFAULT_SETTINGS, '')).toBe(CANONICAL_DEFAULTS);
  });

  it('writes numbers in shortest form', () => {
    expect(serializeSettings(withSettings({ pitch: -3, speed: 15, variation: 0.05 }), '')).toBe(
      '?text=Hello&style=beep&pitch=-3&speed=15&variation=0.05',
    );
    expect(serializeSettings(withSettings({ variation: 1 }), '')).toContain('&variation=1');
  });

  it('keeps non-owned pairs after the owned ones, in original order', () => {
    const out = serializeSettings(withSettings({ text: 'a' }), '?utm=x&text=b&ref=y');
    expect(out).toBe('?text=a&style=beep&pitch=0&speed=15&variation=0&utm=x&ref=y');
  });

  it('drops duplicate owned keys from the input search and writes each owned key once', () => {
    const out = serializeSettings(DEFAULT_SETTINGS, '?pitch=3&utm=1&pitch=5&style=grunt');
    expect(out).toBe(CANONICAL_DEFAULTS + '&utm=1');
    expect(out.match(/pitch=/g)).toHaveLength(1);
  });

  it('keeps the value of a foreign parameter that needs encoding', () => {
    const out = serializeSettings(DEFAULT_SETTINGS, '?q=a%26b%20c%23d');
    expect(new URLSearchParams(out).get('q')).toBe('a&b c#d');
  });

  it('writes an empty text as text=', () => {
    expect(serializeSettings(withSettings({ text: '' }), '')).toBe('?text=&style=beep&pitch=0&speed=15&variation=0');
  });
});

describe('no parameters (R9.4)', () => {
  it.each(['', '?', '?foo=1', '?utm_source=x&ref=y'])('%j gives defaults and present = false', (search) => {
    expect(parseSettings(search)).toEqual({ settings: DEFAULT_SETTINGS, present: false });
  });
});

describe('missing parameters (R9.4, R9.5)', () => {
  it('?text=Hi sets only the text', () => {
    expect(parseSettings('?text=Hi')).toEqual({ settings: withSettings({ text: 'Hi' }), present: true });
  });

  it('?style=grunt sets only the style', () => {
    expect(parseSettings('?style=grunt')).toEqual({ settings: withSettings({ style: 'grunt' }), present: true });
  });

  it('a single numeric parameter leaves the others default', () => {
    expect(parse('?speed=20')).toEqual(withSettings({ speed: 20 }));
  });
});

describe('malformed numbers fall back to the default (R9.5)', () => {
  const bad = ['', 'abc', 'NaN', 'Infinity', '-Infinity', '0x10', '1e3', ' 3', '3 ', '.5', '+3', '%203', '1.', '--1', '1,5'];

  it.each(bad)('pitch=%j → default', (raw) => {
    expect(parse(qs({ pitch: raw })).pitch).toBe(DEFAULT_SETTINGS.pitch);
  });

  it.each(bad)('speed=%j → default', (raw) => {
    expect(parse(qs({ speed: raw })).speed).toBe(DEFAULT_SETTINGS.speed);
  });

  it.each(bad)('variation=%j → default', (raw) => {
    expect(parse(qs({ variation: raw })).variation).toBe(DEFAULT_SETTINGS.variation);
  });

  it('a malformed value does not disturb the other parameters', () => {
    expect(parse('?pitch=abc&speed=20&variation=0.5')).toEqual(withSettings({ speed: 20, variation: 0.5 }));
  });
});

describe('out of range is clamped (R9.5)', () => {
  it.each([
    ['pitch=99', 'pitch', 12],
    ['pitch=-99', 'pitch', -12],
    ['pitch=12.4', 'pitch', 12],
    ['speed=0', 'speed', 5],
    ['speed=100', 'speed', 30],
    ['variation=2', 'variation', 1],
    ['variation=-1', 'variation', 0],
    ['variation=1.02', 'variation', 1],
    ['pitch=99999999999999999999999999', 'pitch', 12],
    ['pitch=-99999999999999999999999999', 'pitch', -12],
    ['speed=1' + '0'.repeat(400), 'speed', 30],
  ] as const)('%s → %s = %d', (search, key, expected) => {
    expect(parse(`?${search}`)[key]).toBe(expected);
  });

  it('-0 is written as 0', () => {
    const { pitch, variation } = parse('?pitch=-0&variation=-0.01');
    expect(Object.is(pitch, 0)).toBe(true);
    expect(Object.is(variation, 0)).toBe(true);
    expect(serializeSettings(parse('?pitch=-0'), '')).toContain('pitch=0&');
  });
});

describe('off-step values round to the nearest step, ties up (R9.5)', () => {
  it.each([
    ['pitch=2.4', 'pitch', 2],
    ['pitch=2.5', 'pitch', 3],
    ['pitch=-2.5', 'pitch', -2],
    ['pitch=-2.6', 'pitch', -3],
    ['speed=10.5', 'speed', 11],
    ['variation=0.33', 'variation', 0.35],
    ['variation=0.12', 'variation', 0.1],
    ['variation=0.125', 'variation', 0.15],
    ['variation=0.975', 'variation', 1],
    ['variation=0.1500000000000001', 'variation', 0.15],
  ] as const)('%s → %s = %d', (search, key, expected) => {
    expect(parse(`?${search}`)[key]).toBe(expected);
  });

  it('every variation step serializes without floating-point residue', () => {
    for (let k = 0; k <= 20; k++) {
      const expected = Number((k / 20).toFixed(2));
      // Input written as the decimal a user would type, and as a value with residue from k * 0.05.
      for (const raw of [(k * 0.05).toFixed(2), String(k * 0.05)]) {
        const query = serializeSettings(parse(qs({ variation: raw })), '');
        const written = new URLSearchParams(query).get('variation')!;
        expect(written).toBe(String(expected));
        expect(written.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('never writes a long decimal tail in the serialization', () => {
    const query = serializeSettings(parse('?variation=0.35000000000000003'), '');
    expect(query).toMatch(/variation=0\.35$/);
    expect(query).not.toMatch(/\d{6,}/);
  });
});

describe('style (R9.6)', () => {
  it.each(['grunt', 'alphabet', 'beep'])('accepts %s', (style) => {
    expect(parse(qs({ style })).style).toBe(style);
  });

  it.each(['Grunt', 'ALPHABET', 'robot', '', ' grunt', 'grunt ', 'beep&'])('%j → beep', (style) => {
    expect(parse(qs({ style })).style).toBe('beep');
  });

  it('missing style → beep', () => {
    expect(parse('?text=x').style).toBe('beep');
  });
});

describe('text (R9.7)', () => {
  it('missing text → Hello', () => {
    expect(parse('?pitch=1').text).toBe('Hello');
  });

  it('empty text stays empty and counts as present', () => {
    expect(parseSettings('?text=')).toEqual({ settings: withSettings({ text: '' }), present: true });
  });

  it('+ and %20 both parse as a space', () => {
    expect(parse('?text=+').text).toBe(' ');
    expect(parse('?text=%20').text).toBe(' ');
    expect(parse('?text=a+b%20c').text).toBe('a b c');
  });

  it('CRLF, CR and LF all become \\n', () => {
    expect(parse('?text=a%0D%0Ab%0Dc%0Ad').text).toBe('a\nb\nc\nd');
    expect(parse(qs({ text: 'x\r\ny\rz' })).text).toBe('x\ny\nz');
  });

  it('a literal ? and # in the text survive the round trip', () => {
    const s = withSettings({ text: 'why? #1' });
    expect(parse(serializeSettings(s, '')).text).toBe('why? #1');
  });

  const samples = [
    'café naïve',
    '日本語のテキスト',
    '👩🏽‍🚀 astronaut',
    '🇮🇹 🏳️‍🌈 👍🏽',
    'é combining', // e + combining acute
    'שלום עולם', // RTL Hebrew
    'مرحبا بالعالم',
    'a&b=c+d%e#f?g\nh',
    '%E0%A4%A literal percent text',
    '+ + +',
    '\u{1F600}\u{1F601}',
  ];

  it.each(samples)('round-trips %j', (text) => {
    const s = withSettings({ text });
    expect(parse(serializeSettings(s, '')).text).toBe(text);
  });

  it('invalid UTF-8 percent sequence decodes to U+FFFD without throwing', () => {
    expect(() => parse('?text=%E0%A4%A')).not.toThrow();
    expect(parse('?text=%E0%A4%A').text).toBe('�%A');
  });

  it('a lone invalid byte decodes to U+FFFD', () => {
    expect(() => parse('?text=%FF')).not.toThrow();
    expect(parse('?text=%FF').text).toBe('�');
  });

  it('a malformed percent escape does not throw', () => {
    // R9.9 says an invalid percent sequence decodes to U+FFFD, but URLSearchParams (WHATWG) keeps a
    // non-hex "%ZZ" literally. This pins the platform behavior; the spec wording is ambiguous.
    expect(() => parse('?text=%ZZ')).not.toThrow();
    expect(parse('?text=%ZZ').text).toBe('%ZZ');
  });
});

describe('text length (R1.2, R9.7)', () => {
  const len = (search: string) => parse(search).text;

  it('500 code units are kept intact', () => {
    const text = 'a'.repeat(MAX_TEXT_LENGTH);
    expect(len(qs({ text }))).toBe(text);
    expect(len(qs({ text })).length).toBe(500);
  });

  it('501 code units are truncated to 500', () => {
    expect(len(qs({ text: 'a'.repeat(501) })).length).toBe(500);
  });

  it('a surrogate pair straddling the limit is dropped, not split', () => {
    const text = 'a'.repeat(499) + '😀'; // 501 code units
    const out = len(qs({ text }));
    expect(out).toBe('a'.repeat(499));
    expect(out.length).toBe(499);
    expect(out.charCodeAt(out.length - 1)).toBeLessThan(0xd800);
  });

  it('a surrogate pair that fits entirely is kept', () => {
    const text = 'a'.repeat(498) + '😀'; // exactly 500 code units
    expect(len(qs({ text }))).toBe(text);
  });

  it('CRLF counts as one line break after normalization', () => {
    const text = 'a'.repeat(499) + '\r\n'; // 501 raw, 500 normalized
    expect(len(qs({ text }))).toBe('a'.repeat(499) + '\n');
  });

  it('the parsed length is what the counter shows', () => {
    const text = 'é'.repeat(300) + '😀'.repeat(150); // 600 code units
    expect(len(qs({ text })).length).toBe(MAX_TEXT_LENGTH);
  });
});

describe('duplicate parameters: first occurrence wins (R9.8)', () => {
  it('pitch=3&pitch=5 → 3', () => {
    expect(parse('?pitch=3&pitch=5').pitch).toBe(3);
  });

  it('pitch=abc&pitch=5 → default, not 5', () => {
    expect(parse('?pitch=abc&pitch=5').pitch).toBe(DEFAULT_SETTINGS.pitch);
  });

  it('duplicate text and style follow the same rule', () => {
    expect(parse('?text=a&text=b&style=grunt&style=alphabet')).toEqual(withSettings({ text: 'a', style: 'grunt' }));
  });

  it('the serialization contains each owned key once', () => {
    const query = serializeSettings(parse('?pitch=3&pitch=5&text=x&text=y'), '');
    for (const key of ['text', 'style', 'pitch', 'speed', 'variation']) {
      expect(query.match(new RegExp(`[?&]${key}=`, 'g'))).toHaveLength(1);
    }
  });
});

describe('controls markup agrees with SLIDER_LIMITS (R4.1, R9.5)', () => {
  // controls.ts overwrites min/max/step at runtime, but the markup is what the page shows before
  // main.ts runs. The playground has no DOM environment in Vitest, so the check reads index.html.
  const sliderAttrs = (id: string) => {
    const tag = indexHtml.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0] ?? '';
    const attr = (name: string) => Number(tag.match(new RegExp(`${name}="([^"]+)"`))?.[1]);
    return { min: attr('min'), max: attr('max'), step: attr('step') };
  };

  it.each(Object.keys(SLIDER_LIMITS) as (keyof typeof SLIDER_LIMITS)[])('%s slider', (key) => {
    expect(sliderAttrs(key)).toEqual(SLIDER_LIMITS[key]);
  });

  it('the textarea maxlength equals MAX_TEXT_LENGTH', () => {
    expect(Number(indexHtml.match(/<textarea id="text"[^>]*maxlength="(\d+)"/)?.[1])).toBe(MAX_TEXT_LENGTH);
  });
});
