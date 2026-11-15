import type { Hyphenator, InlineRun } from './types';
/** Letters a word must keep on each side of a break. */
export interface HyphenateOptions {
    minWordLength: number;
    leftMin: number;
    rightMin: number;
    skipCapitalized: boolean;
}
type HyphenateFn = (text: string, options?: {
    hyphenChar?: string;
    minWordLength?: number;
}) => string;
/** Wraps a pattern-pack `hyphenateSync` into a `Hyphenator` with the engine's length rules. */
export declare function createHyphenator(hyphenate: HyphenateFn, options?: Partial<HyphenateOptions>): Hyphenator;
/** Soft-hyphenates the words of body runs. Marks are kept and the input is not changed. A run with
 *  `href` is copied as it is. A word that starts or ends its run while the neighbouring text
 *  touches it without whitespace may be half a word, so it is left alone. */
export declare function hyphenateRuns(runs: InlineRun[], hyphenator: Hyphenator): InlineRun[];
/** Loads the pattern pack for a locale's language subtag (`en`, `es`, `fr`), or `null` for any
 *  other language. The packs are CommonJS, so `hyphenateSync` is read from the module or its
 *  `default`. */
export declare function loadHyphenator(locale: string): Promise<Hyphenator | null>;
export {};
