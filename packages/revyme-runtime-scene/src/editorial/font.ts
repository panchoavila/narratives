// editorial/font.ts — the one place a font is made. Every FontSpec the engine builds goes through
// `makeFont`, so no font string a browser canvas would reject can reach the measurer or the result:
// weight is a finite whole number in 1…1000 (else 400), size is finite and at least 1, and letter
// spacing is finite (else 0). Pure: no measurement, no DOM.

import type { FontSpec } from './types';

const NEUTRAL_WEIGHT = 400;

/** A weight a canvas accepts: a finite whole number in 1…1000, else the neutral weight. */
export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return NEUTRAL_WEIGHT;
  return Math.min(1000, Math.max(1, Math.round(weight)));
}

/** The weight of a strong run: at least bold, at most 900, and never lighter than the face. */
export function boldWeight(weight: number): number {
  return Math.min(900, Math.max(700, clampWeight(weight) + 300));
}

export function makeFont(
  family: string,
  weight: number,
  style: 'normal' | 'italic',
  size: number,
  letterSpacing?: number,
): FontSpec {
  const font: FontSpec = {
    family,
    weight: clampWeight(weight),
    style,
    size: Number.isFinite(size) ? Math.max(1, size) : 1,
  };
  if (letterSpacing !== undefined) font.letterSpacing = Number.isFinite(letterSpacing) ? letterSpacing : 0;
  return font;
}
