// editorial/hyphenate.ts — soft-hyphen insertion for body text, over the `hyphen` pattern packs.
//
// The engine breaks a line at a soft hyphen (U+00AD) and paints a hyphen there, so this module
// only marks the breaks the patterns allow. It never changes a letter. The minimum fragment
// lengths, the words it leaves alone, and the rule for words cut by an inline boundary are all
// decided here, not in the pattern packs.

import type { Hyphenator, InlineRun } from './types';

const SHY = '\u00AD';

/** Letters a word must keep on each side of a break. */
export interface HyphenateOptions {
  minWordLength: number;
  leftMin: number;
  rightMin: number;
  skipCapitalized: boolean;
}

type HyphenateFn = (text: string, options?: { hyphenChar?: string; minWordLength?: number }) => string;

/** A word of letters, which may already carry soft hyphens. Apostrophes end a word. */
const WORD = /[\p{L}\u00AD]+/gu;

function countLetters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

/** Wraps a pattern-pack `hyphenateSync` into a `Hyphenator` with the engine's length rules. */
export function createHyphenator(hyphenate: HyphenateFn, options: Partial<HyphenateOptions> = {}): Hyphenator {
  const minWordLength = options.minWordLength ?? 6;
  const leftMin = options.leftMin ?? 2;
  const rightMin = options.rightMin ?? 3;
  const skipCapitalized = options.skipCapitalized ?? false;

  return (word: string): string => {
    if (word.length < minWordLength) return word;
    if (/\p{Nd}/u.test(word)) return word;
    if (skipCapitalized && /^\p{Lu}/u.test(word)) return word;
    if (word.includes(SHY)) return word;

    const marked = hyphenate(word, { hyphenChar: SHY, minWordLength });
    const parts = marked.split(SHY);
    // The pattern pack may only add breaks. If it changed any character, keep the word as it was.
    if (parts.join('') !== word) return word;
    if (parts.length === 1) return word;

    const total = countLetters(word);
    let result = parts[0];
    let before = countLetters(parts[0]);
    for (let k = 1; k < parts.length; k += 1) {
      const piece = parts[k];
      const after = total - before;
      const allowed = before >= leftMin && after >= rightMin;
      result += (allowed ? SHY : '') + piece;
      before += countLetters(piece);
    }
    return result;
  };
}

function touchesWithoutSpace(runs: InlineRun[], index: number, step: -1 | 1): boolean {
  for (let j = index + step; j >= 0 && j < runs.length; j += step) {
    const text = runs[j].text;
    if (text === '') continue;
    const edge = step === -1 ? text.charAt(text.length - 1) : text.charAt(0);
    return !/\s/.test(edge);
  }
  return false;
}

/** Soft-hyphenates the words of body runs. Marks are kept and the input is not changed. A run with
 *  `href` is copied as it is. A word that starts or ends its run while the neighbouring text
 *  touches it without whitespace may be half a word, so it is left alone. */
export function hyphenateRuns(runs: InlineRun[], hyphenator: Hyphenator): InlineRun[] {
  return runs.map((run, index) => {
    if (run.href !== undefined) return { ...run };
    const leftTouches = touchesWithoutSpace(runs, index, -1);
    const rightTouches = touchesWithoutSpace(runs, index, 1);
    const text = run.text.replace(WORD, (word: string, offset: number) => {
      const startsRun = offset === 0;
      const endsRun = offset + word.length === run.text.length;
      if ((startsRun && leftTouches) || (endsRun && rightTouches)) return word;
      return hyphenator(word);
    });
    return { ...run, text };
  });
}

type HyphenModule = {
  hyphenateSync?: HyphenateFn;
  default?: { hyphenateSync?: HyphenateFn };
};

/** Loads the pattern pack for a locale's language subtag (`en`, `es`, `fr`), or `null` for any
 *  other language. The packs are CommonJS, so `hyphenateSync` is read from the module or its
 *  `default`. */
export async function loadHyphenator(locale: string): Promise<Hyphenator | null> {
  const language = (locale.split(/[-_]/)[0] ?? '').toLowerCase();
  let pack: HyphenModule;
  switch (language) {
    case 'en':
      pack = await import('hyphen/en-us');
      break;
    case 'es':
      pack = await import('hyphen/es');
      break;
    case 'fr':
      pack = await import('hyphen/fr');
      break;
    default:
      return null;
  }
  const hyphenate = pack.hyphenateSync ?? pack.default?.hyphenateSync;
  if (hyphenate === undefined) {
    throw new Error(`hyphen pack for "${language}" exports no hyphenateSync`);
  }
  return createHyphenator(hyphenate);
}
