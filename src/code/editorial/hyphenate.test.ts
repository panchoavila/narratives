// hyphenate.test.ts — spec §2: soft-hyphen insertion rules, run handling and locale loading.
//
// The dictionary is replaced by a fake that breaks after every second letter, so every expected
// string below can be read off by eye. The fake deliberately ignores minWordLength, so the wrapper's
// own guards are what these tests exercise.

import { describe, expect, it } from 'vitest';
import {
  createHyphenator,
  hyphenateRuns,
  loadHyphenator,
} from '../../../packages/revyme-runtime-scene/src/editorial';
import type { InlineRun } from '../../../packages/revyme-runtime-scene/src/editorial';

const SHY = '­';

type HyphenOptions = { hyphenChar?: string; minWordLength?: number };

/** Breaks after every second letter: abcdefgh -> ab|cd|ef|gh. */
function everyTwo(word: string, options?: HyphenOptions): string {
  const sep = options?.hyphenChar ?? '-';
  const chars = [...word];
  let out = '';
  chars.forEach((ch, i) => {
    out += ch;
    if ((i + 1) % 2 === 0 && i + 1 < chars.length) out += sep;
  });
  return out;
}

function recordingHyphenator(calls: Array<HyphenOptions | undefined>) {
  return (word: string, options?: HyphenOptions): string => {
    calls.push(options);
    return everyTwo(word, options);
  };
}

function summarise(runs: InlineRun[]) {
  return runs.map((r) => ({ text: r.text, em: r.em === true, strong: r.strong === true, href: r.href ?? null }));
}

describe('createHyphenator: calls and defaults', () => {
  it('asks the dictionary for a soft hyphen with the default minimum word length of 6', () => {
    const calls: Array<HyphenOptions | undefined> = [];
    const hyphenate = createHyphenator(recordingHyphenator(calls));
    hyphenate('abcdefgh');
    expect(calls).toEqual([{ hyphenChar: SHY, minWordLength: 6 }]);
  });

  it('passes a custom minWordLength through to the dictionary', () => {
    const calls: Array<HyphenOptions | undefined> = [];
    const hyphenate = createHyphenator(recordingHyphenator(calls), { minWordLength: 4 });
    hyphenate('abcdef');
    expect(calls).toEqual([{ hyphenChar: SHY, minWordLength: 4 }]);
  });
});

describe('createHyphenator: which breaks survive', () => {
  it('keeps every break with at least 2 letters before and 3 after', () => {
    // ab|cd|ef|gh: after 2 (2 before, 6 after) keep; after 4 (4, 4) keep; after 6 (6, 2) drop.
    const hyphenate = createHyphenator(everyTwo);
    expect(hyphenate('abcdefgh')).toBe(`ab${SHY}cd${SHY}efgh`);
  });

  it('removes a break that leaves fewer than leftMin letters before it', () => {
    // leftMin 3 drops the break after 2; the break after 4 (4 before, 4 after) survives; after 6 drops.
    const hyphenate = createHyphenator(everyTwo, { leftMin: 3 });
    expect(hyphenate('abcdefgh')).toBe(`abcd${SHY}efgh`);
  });

  it('removes a break that leaves fewer than rightMin letters after it', () => {
    // rightMin 2 keeps the break after 6 (2 letters after it), which the default would drop.
    const hyphenate = createHyphenator(everyTwo, { rightMin: 2 });
    expect(hyphenate('abcdefgh')).toBe(`ab${SHY}cd${SHY}ef${SHY}gh`);
  });

  it('returns a word shorter than minWordLength unchanged', () => {
    // Five letters: the fake would break after 2 (3 after it), so only the length guard keeps it whole.
    const hyphenate = createHyphenator(everyTwo);
    expect(hyphenate('abcde')).toBe('abcde');
  });

  it('hyphenates a word of exactly minWordLength letters', () => {
    // abcdef: after 2 (4 after) keep; after 4 (2 after) drop.
    const hyphenate = createHyphenator(everyTwo);
    expect(hyphenate('abcdef')).toBe(`ab${SHY}cdef`);
  });

  it('honours a smaller minWordLength option', () => {
    const hyphenate = createHyphenator(everyTwo, { minWordLength: 4 });
    expect(hyphenate('abcde')).toBe(`ab${SHY}cde`);
  });

  it('returns a word containing a digit unchanged', () => {
    const hyphenate = createHyphenator(everyTwo);
    expect(hyphenate('abcdefg1')).toBe('abcdefg1');
  });

  it('hyphenates a capitalised word when skipCapitalized is false, the default', () => {
    const hyphenate = createHyphenator(everyTwo);
    expect(hyphenate('Abcdefgh')).toBe(`Ab${SHY}cd${SHY}efgh`);
  });

  it('returns a capitalised word unchanged when skipCapitalized is true', () => {
    const hyphenate = createHyphenator(everyTwo, { skipCapitalized: true });
    expect(hyphenate('Abcdefgh')).toBe('Abcdefgh');
  });

  it('still hyphenates a lowercase word when skipCapitalized is true', () => {
    const hyphenate = createHyphenator(everyTwo, { skipCapitalized: true });
    expect(hyphenate('abcdefgh')).toBe(`ab${SHY}cd${SHY}efgh`);
  });

  it('returns a word that already contains a soft hyphen unchanged', () => {
    const hyphenate = createHyphenator(everyTwo);
    const word = `ab${SHY}cdefgh`;
    expect(hyphenate(word)).toBe(word);
  });
});

describe('hyphenateRuns', () => {
  it('keeps each run marks and returns new runs without mutating the input', () => {
    const runs: InlineRun[] = [
      { text: 'abcdefgh', em: true },
      { text: ' tail', strong: true },
    ];
    const snapshot = JSON.stringify(runs);
    const out = hyphenateRuns(runs, createHyphenator(everyTwo));
    expect(summarise(out)).toEqual([
      { text: `ab${SHY}cd${SHY}efgh`, em: true, strong: false, href: null },
      { text: ' tail', em: false, strong: true, href: null },
    ]);
    expect(JSON.stringify(runs)).toBe(snapshot);
    expect(out).not.toBe(runs);
  });

  it('leaves a run with an href untouched', () => {
    const runs: InlineRun[] = [{ text: 'abcdefgh', href: 'https://example.test/' }];
    expect(hyphenateRuns(runs, createHyphenator(everyTwo))).toEqual(runs);
  });

  it('leaves a word unchanged when it runs into the next run without whitespace', () => {
    // "abcd" touches the end of run 1; run 2 starts with letters, so it may be half a word.
    // "efghij" touches the start of run 2; run 1 ends with letters, so it may be half a word.
    const runs: InlineRun[] = [{ text: 'abcd' }, { text: 'efghij' }];
    const out = hyphenateRuns(runs, createHyphenator(everyTwo));
    expect(out.map((r) => r.text)).toEqual(['abcd', 'efghij']);
  });

  it('hyphenates a word at a run start when whitespace separates it from the previous run', () => {
    const runs: InlineRun[] = [{ text: 'abcd ' }, { text: 'efghij' }];
    const out = hyphenateRuns(runs, createHyphenator(everyTwo));
    expect(out.map((r) => r.text)).toEqual(['abcd ', `ef${SHY}ghij`]);
  });

  it('treats an apostrophe as a word boundary', () => {
    // "hyphenation" is hyphenated; "s" is a word of its own and too short to change.
    const runs: InlineRun[] = [{ text: "hyphenation's" }];
    const out = hyphenateRuns(runs, createHyphenator(everyTwo));
    expect(out[0].text).toBe(`hy${SHY}ph${SHY}en${SHY}at${SHY}ion's`);
  });

  it('returns an empty array for no runs', () => {
    expect(hyphenateRuns([], createHyphenator(everyTwo))).toEqual([]);
  });

  it('leaves a run without letters unchanged', () => {
    const runs: InlineRun[] = [{ text: '  12 - 34 ' }];
    expect(hyphenateRuns(runs, createHyphenator(everyTwo))).toEqual(runs);
  });
});

describe('loadHyphenator', () => {
  it('returns a hyphenator for English', async () => {
    const hyphenate = await loadHyphenator('en');
    expect(typeof hyphenate).toBe('function');
    const out = hyphenate!('hyphenation');
    expect(out).toContain(SHY);
    expect(out.split(SHY).join('')).toBe('hyphenation');
  });

  it('accepts a regional English subtag', async () => {
    expect(typeof (await loadHyphenator('en-GB'))).toBe('function');
  });

  it('returns a hyphenator for Spanish', async () => {
    const hyphenate = await loadHyphenator('es');
    expect(typeof hyphenate).toBe('function');
    expect(hyphenate!('computadora')).toContain(SHY);
  });

  it('returns a hyphenator for French', async () => {
    expect(typeof (await loadHyphenator('fr'))).toBe('function');
  });

  it('returns null for a language with no dictionary', async () => {
    expect(await loadHyphenator('de')).toBeNull();
  });

  it('returns null for an empty locale', async () => {
    expect(await loadHyphenator('')).toBeNull();
  });
});
