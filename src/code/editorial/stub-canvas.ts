// stub-canvas.ts — a deterministic text-measuring canvas for the editorial engine's tests.
//
// Pretext measures through `OffscreenCanvas` when one is defined, and documents supplying your
// own as the way to run outside a browser: lines then break by its real rules over the widths
// given here. So these tests exercise the real line breaker, with arithmetic anyone can check
// by hand:
//
//   width of a grapheme = 0.5 × font size
//   width of a space    = 0.25 × font size
//   soft hyphen (U+00AD) and zero-width characters = 0
//   weight >= 600 multiplies by 1.1, italic by 0.9
//
// At `16px` a letter is 8px and a space 4px, so "aaaa aaaa" is 68px.

const ZERO_WIDTH = new Set(['­', '​', '‌', '‍', '⁠', '﻿']);

function parseFont(font: string): { size: number; factor: number } {
  const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '10');
  const weight = /\b([1-9]00)\b/.exec(font.replace(/(\d+(?:\.\d+)?)px/, ''))?.[1];
  const bold = /\bbold\b/.test(font) || (weight !== undefined && Number(weight) >= 600);
  const italic = /\bitalic\b/.test(font);
  return { size, factor: (bold ? 1.1 : 1) * (italic ? 0.9 : 1) };
}

/** Width the stub reports for `text` in the canvas font string `font`. */
export function stubWidth(text: string, font: string): number {
  const { size, factor } = parseFont(font);
  let width = 0;
  for (const grapheme of text) {
    if (ZERO_WIDTH.has(grapheme) || grapheme === '\n') continue;
    width += (grapheme === ' ' || grapheme === ' ' ? 0.25 : 0.5) * size * factor;
  }
  return width;
}

class StubContext {
  font = '10px sans-serif';
  measureText(text: string) {
    const { size } = parseFont(this.font);
    return {
      width: stubWidth(text, this.font),
      actualBoundingBoxAscent: size * 0.7,
      actualBoundingBoxDescent: 0,
      fontBoundingBoxAscent: size * 0.8,
      fontBoundingBoxDescent: size * 0.2,
    };
  }
}

class StubOffscreenCanvas {
  constructor(public width = 1, public height = 1) {}
  getContext() { return new StubContext(); }
}

/** Install the stub as the global `OffscreenCanvas`. Call before the first measurement. */
export function installStubCanvas(): void {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = StubOffscreenCanvas;
}
