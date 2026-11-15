// editorial/presets.ts — the built-in editorial layouts.
//
// A preset is a recipe: grid, body typography, and where each ROLE goes. It names no fonts of
// its own — a site passes a theme (its display, sans and serif faces) and gets a `FlowSpec`
// back, so the same seven layouts serve any publication.
//
// Each preset is traceable to a printed reference it was reduced from:
//   cover-story  a headline whose every line fills the spread, drop cap, a quote crossing columns
//   profile      a tall portrait holding one side of the page, the text running beside it
//   interview    a narrow measure with an oversized quote pushing in from the outer edge
//   report       a condensed headline over two columns, deck, compact columns, no drop cap
//   review       an asymmetric opening: verdict and score on the left, the text to the right
//   letter       a small portrait and a headline the columns step around, then a signature
//   plate        a tracked title over a full-width picture, short captioned columns
//
// Placement is expressed only in columns, lines and fractions, so every preset resolves at any
// viewport: spans clamp to the columns that exist, and with one column everything stacks.

import type { BodySpec, FlowSpec, GridSpec, ObjectRole, RoleRule, TypeStyle } from './types';

export interface EditorialFont { family: string; weight: number }

/** The faces a publication sets its pieces in. */
export interface EditorialTheme {
  /** Headlines and other display lines. */
  display: EditorialFont;
  /** Kickers, bylines, crossheads, labels. */
  sans: EditorialFont;
  /** Body text and decks. */
  serif: EditorialFont;
}

export const EDITORIAL_PRESET_IDS = [
  'cover-story', 'profile', 'interview', 'report', 'review', 'letter', 'plate',
] as const;

export type EditorialPresetId = typeof EDITORIAL_PRESET_IDS[number];

export function isEditorialPresetId(value: unknown): value is EditorialPresetId {
  return typeof value === 'string' && (EDITORIAL_PRESET_IDS as readonly string[]).includes(value);
}

const style = (font: EditorialFont, scale: number, leading: number, extra: Partial<TypeStyle> = {}): TypeStyle => ({
  family: font.family, weight: font.weight, style: 'normal', scale, leading, ...extra,
});

function body(theme: EditorialTheme, extra: Partial<BodySpec> = {}): BodySpec {
  return {
    family: theme.serif.family,
    weight: theme.serif.weight,
    leading: 1.38,
    justify: true,
    maxStretch: 0.32,
    maxShrink: 0.05,
    hyphenate: true,
    indent: 1,
    paragraphGap: 0,
    dropCap: null,
    widows: 2,
    orphans: 2,
    crosshead: { ...style(theme.sans, 0.95, 1.38, { uppercase: true, tracking: 0.08 }), spaceBefore: 1 },
    ...extra,
  };
}

const grid = (measure: GridSpec['measure'], maxColumns: number, extra: Partial<GridSpec> = {}): GridSpec => ({
  measure, maxColumns, gap: 1.25, margin: [3, 3, 3, 3], bodySize: [15, 19], ...extra,
});

/** Roles every preset sets the same way unless it says otherwise. */
function commonRoles(theme: EditorialTheme): Partial<Record<ObjectRole, RoleRule>> {
  return {
    kicker: {
      style: style(theme.sans, 0.82, 1.3, { uppercase: true, tracking: 0.14 }),
      fit: { kind: 'none' },
      place: { column: 0, span: 2, vertical: 'top', clearance: 0.5 },
      height: { kind: 'text' },
    },
    byline: {
      style: style(theme.sans, 0.78, 1.3, { uppercase: true, tracking: 0.1 }),
      fit: { kind: 'none' },
      place: { column: 0, span: 2, vertical: 'top', clearance: 1 },
      height: { kind: 'text' },
    },
    media: {
      fit: { kind: 'none' },
      place: { column: 'anchor', span: 1, vertical: 'anchor', clearance: 1 },
      height: { kind: 'aspect', ratio: 1.5 },
    },
    quote: {
      style: { ...style(theme.serif, 1.55, 1.2), style: 'italic' },
      fit: { kind: 'none' },
      place: { column: 'anchor', span: 1, vertical: 'anchor', clearance: 1 },
      height: { kind: 'text' },
    },
    caption: {
      style: style(theme.sans, 0.74, 1.3),
      fit: { kind: 'none' },
      place: { column: 'anchor', span: 1, vertical: 'anchor', clearance: 0.5 },
      height: { kind: 'text' },
    },
    signature: {
      style: { ...style(theme.serif, 1.5, 1.2), style: 'italic', align: 'end' },
      fit: { kind: 'none' },
      place: { column: 'anchor', span: 1, vertical: 'anchor', clearance: 1 },
      height: { kind: 'text' },
    },
  };
}

/** In few columns a hero cannot hold a side of the page: it becomes a picture across the top. */
const heroAcross = (ratio: number, maxHeight: number): Partial<RoleRule> => ({
  place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
  height: { kind: 'aspect', ratio },
  maxHeight,
});

/** In few columns a quote cannot cross columns: it is set in the flow, where it is said. */
const quoteInFlow = (font: EditorialFont, scale: number, extra: Partial<TypeStyle> = {}): Partial<RoleRule> => ({
  style: style(font, scale, 1.14, extra),
  fit: { kind: 'none' },
  place: { column: 'anchor', span: 1, vertical: 'anchor', clearance: 1 },
  height: { kind: 'text' },
});

type PresetBuilder = (theme: EditorialTheme) => Omit<FlowSpec, 'id'>;

const BUILDERS: Record<EditorialPresetId, PresetBuilder> = {
  'cover-story': (theme) => ({
    grid: grid([30, 38, 50], 4),
    body: body(theme, { dropCap: { lines: 4, family: theme.display.family, weight: theme.display.weight } }),
    roles: {
      ...commonRoles(theme),
      kicker: {
        style: style(theme.sans, 0.82, 1.3, { uppercase: true, tracking: 0.14 }),
        fit: { kind: 'none' },
        place: { column: 0, span: 'all', vertical: 'top', clearance: 0.5 },
        height: { kind: 'text' },
      },
      headline: {
        style: style(theme.display, 4, 0.9, { uppercase: true }),
        fit: { kind: 'lines', lines: 'auto', maxLines: 3, maxScale: 16 },
        place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
        maxHeight: 0.46,
      },
      deck: {
        style: { ...style(theme.serif, 1.4, 1.28), style: 'italic' },
        fit: { kind: 'none' },
        place: { column: 0, span: 2, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
      hero: {
        fit: { kind: 'none' },
        place: { column: -2, span: 2, vertical: 'top', clearance: 1 },
        height: { kind: 'fill' },
      },
      quote: {
        style: style(theme.sans, 2.2, 1.04, { uppercase: true }),
        fit: { kind: 'box', minScale: 1.4, maxScale: 3.2 },
        place: { column: 1, span: 2, vertical: 'middle', clearance: 1 },
        height: { kind: 'lines', lines: 8 },
      },
    },
    compact: {
      columns: 2,
      roles: {
        hero: heroAcross(1.6, 0.4),
        quote: quoteInFlow(theme.sans, 1.7, { uppercase: true }),
        deck: {
          place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
        },
      },
    },
  }),

  profile: (theme) => ({
    grid: grid([30, 38, 50], 4),
    body: body(theme, { dropCap: { lines: 3 } }),
    roles: {
      ...commonRoles(theme),
      headline: {
        style: style(theme.display, 3.4, 0.92, { uppercase: true }),
        fit: { kind: 'width', lines: 'auto', maxLines: 3, maxScale: 9 },
        place: { column: 0, span: 2, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
        maxHeight: 0.4,
      },
      deck: {
        style: { ...style(theme.serif, 1.3, 1.3), style: 'italic' },
        fit: { kind: 'none' },
        place: { column: 0, span: 2, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
      hero: {
        fit: { kind: 'none' },
        place: { column: -2, span: 2, vertical: 'top', inset: { side: 'end', fraction: 0.86 }, clearance: 1 },
        height: { kind: 'fill' },
      },
      quote: {
        style: { ...style(theme.serif, 1.9, 1.16), style: 'italic', align: 'center' },
        fit: { kind: 'box', minScale: 1.3, maxScale: 2.4 },
        place: { column: 0, span: 2, vertical: 'middle', clearance: 1 },
        height: { kind: 'lines', lines: 6 },
      },
    },
    compact: {
      columns: 2,
      roles: {
        hero: heroAcross(1.25, 0.5),
        quote: quoteInFlow(theme.serif, 1.6, { style: 'italic' }),
      },
    },
  }),

  interview: (theme) => ({
    grid: grid([34, 44, 58], 2, { gap: 2 }),
    body: body(theme),
    roles: {
      ...commonRoles(theme),
      headline: {
        style: { ...style(theme.serif, 3, 1.02), style: 'italic' },
        fit: { kind: 'width', lines: 'auto', maxLines: 2, maxScale: 5 },
        place: { column: 0, span: 1, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
        maxHeight: 0.3,
      },
      deck: {
        style: style(theme.sans, 1.05, 1.3),
        fit: { kind: 'none' },
        place: { column: 0, span: 1, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
      byline: {
        style: style(theme.sans, 0.78, 1.3, { uppercase: true, tracking: 0.1 }),
        fit: { kind: 'none' },
        place: { column: 0, span: 1, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
      hero: {
        fit: { kind: 'none' },
        place: { column: -1, span: 1, vertical: 'top', clearance: 1 },
        height: { kind: 'aspect', ratio: 0.9 },
        maxHeight: 0.6,
      },
      quote: {
        style: style(theme.display, 3, 0.94, { uppercase: true }),
        fit: { kind: 'box', minScale: 1.8, maxScale: 5 },
        place: { column: -1, span: 1, vertical: 'middle', inset: { side: 'end', fraction: 0.64 }, clearance: 1 },
        height: { kind: 'lines', lines: 12 },
      },
    },
  }),

  report: (theme) => ({
    grid: grid([30, 34, 46], 5, { gap: 1, bodySize: [14, 17] }),
    body: body(theme, { indent: 1 }),
    roles: {
      ...commonRoles(theme),
      headline: {
        style: style(theme.sans, 3, 0.94, { uppercase: true }),
        fit: { kind: 'width', lines: 'auto', maxLines: 4, maxScale: 6 },
        place: { column: 0, span: 2, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
        maxHeight: 0.42,
      },
      deck: {
        style: { ...style(theme.serif, 1.25, 1.3), style: 'italic' },
        fit: { kind: 'none' },
        place: { column: 0, span: 2, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
      hero: {
        fit: { kind: 'none' },
        place: { column: 2, span: 'all', vertical: 'top', clearance: 1 },
        height: { kind: 'aspect', ratio: 1.9 },
        maxHeight: 0.5,
      },
      quote: {
        style: { ...style(theme.serif, 1.6, 1.16, { align: 'center' }), weight: 700 },
        fit: { kind: 'none' },
        place: { column: 1, span: 2, vertical: 'middle', clearance: 1 },
        height: { kind: 'text' },
      },
    },
  }),

  review: (theme) => ({
    grid: grid([30, 38, 50], 4),
    body: body(theme, { openingColumn: 2, dropCap: { lines: 3, family: theme.display.family, weight: theme.display.weight } }),
    roles: {
      ...commonRoles(theme),
      headline: {
        style: style(theme.display, 3.6, 0.9, { uppercase: true }),
        fit: { kind: 'width', lines: 'auto', maxLines: 4, maxScale: 9 },
        place: { column: 0, span: 2, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
        maxHeight: 0.5,
      },
      deck: {
        style: style(theme.sans, 1.15, 1.26),
        fit: { kind: 'none' },
        place: { column: 0, span: 2, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
      badge: {
        style: style(theme.display, 5, 0.9, { align: 'start' }),
        fit: { kind: 'none' },
        place: { column: 0, span: 1, vertical: 'bottom', clearance: 1 },
        height: { kind: 'text' },
      },
      hero: {
        fit: { kind: 'none' },
        place: { column: -1, span: 1, vertical: 'top', clearance: 1 },
        height: { kind: 'aspect', ratio: 1 },
      },
      quote: {
        style: { ...style(theme.serif, 1.7, 1.18), style: 'italic' },
        fit: { kind: 'none' },
        place: { column: 'anchor', span: 1, vertical: 'anchor', clearance: 1 },
        height: { kind: 'text' },
      },
    },
    // With three columns or fewer there is no verdict side: everything stacks and text follows.
    compact: {
      columns: 3,
      body: { openingColumn: 0 },
      roles: {
        headline: { maxHeight: 0.3 },
        hero: { place: { column: -1, span: 1, vertical: 'top', clearance: 1 }, height: { kind: 'aspect', ratio: 1.3 }, maxHeight: 0.28 },
        badge: { place: { column: 0, span: 1, vertical: 'top', clearance: 1 } },
      },
      openingOrder: ['kicker', 'headline', 'deck', 'badge', 'byline', 'hero'],
    },
  }),

  letter: (theme) => ({
    grid: grid([28, 36, 48], 4, { gap: 1.5 }),
    body: body(theme, { justify: false }),
    roles: {
      ...commonRoles(theme),
      kicker: {
        style: style(theme.sans, 0.82, 1.3, { uppercase: true, tracking: 0.14 }),
        fit: { kind: 'none' },
        place: { column: 0, span: 1, vertical: 'top', clearance: 0.5 },
        height: { kind: 'text' },
      },
      byline: {
        style: style(theme.sans, 0.78, 1.3, { uppercase: true, tracking: 0.1 }),
        fit: { kind: 'none' },
        place: { column: 0, span: 1, vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
      hero: {
        fit: { kind: 'none' },
        place: { column: 0, span: 1, vertical: 'top', inset: { side: 'start', fraction: 0.7 }, clearance: 1 },
        height: { kind: 'aspect', ratio: 0.8 },
        maxHeight: 0.5,
      },
      headline: {
        style: style(theme.sans, 3.2, 1, { align: 'center' }),
        fit: { kind: 'width', lines: 'auto', maxLines: 4, maxScale: 7 },
        place: { column: 1, span: 'all', vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
        maxHeight: 0.42,
      },
      deck: {
        style: style(theme.sans, 1.1, 1.3, { align: 'center' }),
        fit: { kind: 'none' },
        place: { column: 1, span: 'all', vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
    },
  }),

  plate: (theme) => ({
    grid: grid([32, 40, 54], 3, { gap: 2 }),
    body: body(theme),
    openingOrder: ['kicker', 'headline', 'deck', 'hero', 'byline'],
    roles: {
      ...commonRoles(theme),
      kicker: {
        style: { ...style(theme.serif, 1.1, 1.3, { align: 'center' }), style: 'italic' },
        fit: { kind: 'none' },
        place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
      headline: {
        style: style(theme.display, 6, 1, { uppercase: true, align: 'center' }),
        fit: { kind: 'tracking' },
        place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
        maxHeight: 0.3,
      },
      deck: {
        style: style(theme.sans, 1.2, 1.3, { uppercase: true, tracking: 0.06, align: 'center' }),
        fit: { kind: 'none' },
        place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
      byline: {
        style: { ...style(theme.serif, 0.9, 1.3, { align: 'center' }), style: 'italic' },
        fit: { kind: 'none' },
        place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
        height: { kind: 'text' },
      },
      hero: {
        fit: { kind: 'none' },
        place: { column: 0, span: 'all', vertical: 'top', clearance: 1 },
        height: { kind: 'aspect', ratio: 2.4 },
        maxHeight: 0.34,
      },
    },
  }),
};

/** The `FlowSpec` of a built-in preset set in a publication's faces. */
export function buildEditorialPreset(id: EditorialPresetId, theme: EditorialTheme): FlowSpec {
  return { id, ...BUILDERS[id](theme) };
}
