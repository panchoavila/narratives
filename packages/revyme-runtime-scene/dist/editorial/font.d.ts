import type { FontSpec } from './types';
/** A weight a canvas accepts: a finite whole number in 1…1000, else the neutral weight. */
export declare function clampWeight(weight: number): number;
/** The weight of a strong run: at least bold, at most 900, and never lighter than the face. */
export declare function boldWeight(weight: number): number;
export declare function makeFont(family: string, weight: number, style: 'normal' | 'italic', size: number, letterSpacing?: number): FontSpec;
