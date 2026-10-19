import type { Style, StyleId } from '../core/types.ts';
import { alphabet } from './alphabet.ts';
import { beep } from './beep.ts';
import { grunt } from './grunt.ts';

export const STYLE_LIST: readonly Style[] = [beep, grunt, alphabet];

export const STYLES: Record<StyleId, Style> = { beep, grunt, alphabet };

export const DEFAULT_STYLE: StyleId = 'beep';
