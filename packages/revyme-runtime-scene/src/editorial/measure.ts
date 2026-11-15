// editorial/measure.ts — the engine's text measurer, backed by Pretext.
//
// The only module of the editorial engine that touches a canvas. Pretext breaks lines and reports
// widths over a 2D context it measures on; this module adapts it to the engine's `Measurer`
// contract, keeps the Pretext handles behind the opaque `PreparedParagraph` and `LineCursor`
// objects the engine passes around, and reads vertical font metrics from the same context.
//
// One page has one locale: Pretext keeps its locale process-wide, so `createPretextMeasurer` sets it
// only when it differs from the one this module last set.

import { clearCache, measureNaturalWidth, prepare, setLocale } from '@chenglou/pretext';
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
} from '@chenglou/pretext/rich-inline';
import type { PreparedRichInline, RichInlineCursor, RichInlineItem } from '@chenglou/pretext/rich-inline';
import type {
  FontMetrics,
  FontSpec,
  LineCursor,
  MeasuredFragment,
  MeasuredLine,
  MeasureItem,
  Measurer,
  PreparedParagraph,
} from './types';

const SHY = '\u00AD';

/** The CSS-style font shorthand Canvas and Pretext read, e.g. `italic 700 16px "Tinos", serif`. */
export function fontString(font: FontSpec): string {
  return `${font.style === 'italic' ? 'italic ' : ''}${font.weight} ${font.size}px ${font.family}`;
}

/** The items a paragraph was prepared from, minus the empty ones, with each one's index in the
 *  original array. Pretext reports fragments against the prepared (filtered) list. */
interface PreparedSource {
  text: string;
  originalIndex: number;
}

interface PreparedState {
  inline: PreparedRichInline | null;
  sources: PreparedSource[];
}

type MeasureContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createMeasureContext(): MeasureContext {
  if (typeof OffscreenCanvas !== 'undefined') {
    const context = new OffscreenCanvas(1, 1).getContext('2d');
    if (context !== null) return context;
  }
  if (typeof document !== 'undefined') {
    const context = document.createElement('canvas').getContext('2d');
    if (context !== null) return context;
  }
  throw new Error('editorial measurer: no 2D canvas context is available to measure text');
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/** Builds a `Measurer` over Pretext. Each measurer keeps its own handles and caches. */
let lastLocale: string | undefined;

export function createPretextMeasurer(options: { locale?: string } = {}): Measurer {
  // Pretext's locale is process-wide: set it only when it changes (C9), never clearing caches needlessly.
  if (options.locale !== undefined && options.locale !== lastLocale) {
    setLocale(options.locale);
    lastLocale = options.locale;
  }
  const states = new WeakMap<PreparedParagraph, PreparedState>();
  const cursors = new WeakMap<LineCursor, RichInlineCursor>();
  const widthCache = new Map<string, number>();
  const metricsCache = new Map<string, FontMetrics>();
  let context: MeasureContext | null = null;

  function stateOf(paragraph: PreparedParagraph): PreparedState {
    const state = states.get(paragraph);
    if (state === undefined) throw new Error('editorial measurer: unknown prepared paragraph');
    return state;
  }

  return {
    prepare(items: MeasureItem[]): PreparedParagraph {
      const sources: PreparedSource[] = [];
      const richItems: RichInlineItem[] = [];
      items.forEach((item, originalIndex) => {
        if (item.text === '') return;
        sources.push({ text: item.text, originalIndex });
        richItems.push({
          text: item.text,
          font: fontString(item.font),
          ...(item.font.letterSpacing !== undefined ? { letterSpacing: item.font.letterSpacing } : {}),
        });
      });
      const inline = richItems.length > 0 ? prepareRichInline(richItems) : null;
      const handle: PreparedParagraph = { __preparedParagraph: true };
      states.set(handle, { inline, sources });
      return handle;
    },

    nextLine(paragraph: PreparedParagraph, maxWidth: number, start?: LineCursor): MeasuredLine | null {
      const state = stateOf(paragraph);
      if (state.inline === null) return null;

      let from: RichInlineCursor | undefined;
      if (start !== undefined) {
        from = cursors.get(start);
        if (from === undefined) throw new Error('editorial measurer: unknown line cursor');
      }

      const range = layoutNextRichInlineLineRange(state.inline, Math.max(1, maxWidth), from);
      if (range === null) return null;
      const line = materializeRichInlineLineRange(state.inline, range);

      const rawLast = line.fragments[line.fragments.length - 1];
      let hyphenated = false;
      if (rawLast !== undefined && rawLast.text.endsWith('-')) {
        const source = state.sources[rawLast.itemIndex];
        if (source === undefined) throw new Error('editorial measurer: fragment without a source item');
        hyphenated =
          source.text.charAt(rawLast.sourceEnd - 1) === SHY || source.text.charAt(rawLast.sourceEnd) === SHY;
      }

      const fragments: MeasuredFragment[] = line.fragments.map((fragment) => {
        const source = state.sources[fragment.itemIndex];
        if (source === undefined) throw new Error('editorial measurer: fragment without a source item');
        return {
          itemIndex: source.originalIndex,
          text: fragment.text,
          gapBefore: fragment.gapBefore,
          width: fragment.occupiedWidth,
          sourceStart: fragment.sourceStart,
          sourceEnd: fragment.sourceEnd,
        };
      });

      const last = fragments[fragments.length - 1];
      if (last !== undefined) {
        const trimmed = last.text.replace(/ +$/, '');
        const removed = last.text.length - trimmed.length;
        if (removed > 0) {
          if (trimmed === '') {
            fragments.pop();
          } else {
            last.text = trimmed;
            last.sourceEnd -= removed;
          }
        }
      }

      const end: LineCursor = { __lineCursor: true };
      cursors.set(end, line.end);
      return { width: line.width, fragments, end, hyphenated };
    },

    atEnd(paragraph: PreparedParagraph, cursor: LineCursor): boolean {
      const state = stateOf(paragraph);
      if (state.inline === null) return true;
      const from = cursors.get(cursor);
      if (from === undefined) throw new Error('editorial measurer: unknown line cursor');
      // One grapheme of layout at most: the remainder is never laid out to answer this.
      return layoutNextRichInlineLineRange(state.inline, 1, from) === null;
    },

    invalidate(): void {
      widthCache.clear();
      metricsCache.clear();
      context = null;
      clearCache();
    },

    lineStats(paragraph: PreparedParagraph, maxWidth: number): { lineCount: number; maxLineWidth: number } {
      const state = stateOf(paragraph);
      if (state.inline === null) return { lineCount: 0, maxLineWidth: 0 };
      const stats = measureRichInlineStats(state.inline, Math.max(1, maxWidth));
      return { lineCount: stats.lineCount, maxLineWidth: stats.maxLineWidth };
    },

    naturalWidth(text: string, font: FontSpec): number {
      if (text === '') return 0;
      const letterSpacing = font.letterSpacing ?? 0;
      const key = JSON.stringify([fontString(font), letterSpacing, text]);
      const cached = widthCache.get(key);
      if (cached !== undefined) return cached;
      const width = measureNaturalWidth(prepare(text, fontString(font), { letterSpacing }));
      widthCache.set(key, width);
      return width;
    },

    metrics(font: FontSpec): FontMetrics {
      // C9: one face is measured once, at size 100, and scaled linearly to the size asked for.
      const face = `${font.family}|${font.weight}|${font.style}`;
      let unit = metricsCache.get(face);
      if (unit === undefined) {
        if (context === null) context = createMeasureContext();
        context.font = fontString({ ...font, size: 100, letterSpacing: undefined });
        const measured = context.measureText('H');
        unit = {
          capHeight: finiteOr(measured.actualBoundingBoxAscent, 70) / 100,
          ascent: finiteOr(measured.fontBoundingBoxAscent ?? measured.actualBoundingBoxAscent, 80) / 100,
          descent: finiteOr(measured.fontBoundingBoxDescent ?? measured.actualBoundingBoxDescent, 20) / 100,
        };
        metricsCache.set(face, unit);
      }
      const size = font.size;
      return { capHeight: unit.capHeight * size, ascent: unit.ascent * size, descent: unit.descent * size };
    },
  };
}
