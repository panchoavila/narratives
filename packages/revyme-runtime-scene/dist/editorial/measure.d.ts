import type { FontSpec, Measurer } from './types';
/** The CSS-style font shorthand Canvas and Pretext read, e.g. `italic 700 16px "Tinos", serif`. */
export declare function fontString(font: FontSpec): string;
export declare function createPretextMeasurer(options?: {
    locale?: string;
}): Measurer;
