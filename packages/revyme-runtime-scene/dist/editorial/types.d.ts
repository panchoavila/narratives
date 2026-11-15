export interface Size {
    width: number;
    height: number;
}
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** A concrete font, as painted. `family` is a CSS family list whose first entry is a named font
 *  (`'"Tinos", serif'`), never `system-ui`. `size` and `letterSpacing` are px. */
export interface FontSpec {
    family: string;
    weight: number;
    style: 'normal' | 'italic';
    size: number;
    letterSpacing?: number;
}
/** A font described relative to the body, as presets carry it. */
export interface TypeStyle {
    family: string;
    weight: number;
    style: 'normal' | 'italic';
    /** Font size as a multiple of the resolved body font size. Fit modes may override it. */
    scale: number;
    /** Line height as a multiple of this style's own font size. */
    leading: number;
    /** Letter spacing in em of this style's font size. */
    tracking?: number;
    uppercase?: boolean;
    align?: 'start' | 'center' | 'end';
}
/** A run of text with one set of inline marks. Runs of a paragraph are concatenated as written:
 *  a space between two runs belongs to one of them. */
export interface InlineRun {
    text: string;
    em?: boolean;
    strong?: boolean;
    href?: string;
}
export type ObjectRole = 'kicker' | 'headline' | 'deck' | 'byline' | 'hero' | 'media' | 'quote' | 'caption' | 'aside' | 'badge' | 'signature' | 'folio';
export interface ParagraphBlock {
    kind: 'paragraph';
    id: string;
    role: 'body' | 'crosshead';
    runs: InlineRun[];
}
/** An object whose content is text the engine sets itself (headline, deck, quote…). A `\n` in a
 *  run's text is a forced line break. */
export interface TextObjectBlock {
    kind: 'text-object';
    id: string;
    role: ObjectRole;
    runs: InlineRun[];
}
/** An object the engine only reserves room for (image, video, free-form frame). A caption is not
 *  a property of it: it is a `caption` text object that follows it in the document. The engine
 *  measures the caption and keeps the two together — same column, same page, the caption
 *  directly under the picture at the picture's width. */
export interface MediaObjectBlock {
    kind: 'media-object';
    id: string;
    role: ObjectRole;
    src?: string;
    alt?: string;
    /** Intrinsic width / height. Wins over the role rule's aspect when present. */
    aspect?: number;
    /** A rule of the object's own, shallow-merged over its role's rule: a `place` or `height` given
     *  here replaces the role's whole one. Sanitised like every rule. */
    rule?: Partial<RoleRule>;
}
export type FlowBlock = ParagraphBlock | TextObjectBlock | MediaObjectBlock;
/** Blocks in reading order. An object's position in the array is its ANCHOR: objects before the
 *  first paragraph open the piece; an object between paragraphs is anchored after the paragraph
 *  that precedes it. */
export interface FlowDocument {
    blocks: FlowBlock[];
}
export interface GridSpec {
    /** Characters per line: `[min, ideal, max]`. Drives both the column count and the body size. */
    measure: [number, number, number];
    maxColumns: number;
    /** Column gap, in lines. */
    gap: number;
    /** Page margins in lines: `[top, right, bottom, left]`. */
    margin: [number, number, number, number];
    /** Body font size clamp in px: `[min, max]`. The result is a whole pixel. */
    bodySize: [number, number];
}
export interface BodySpec {
    family: string;
    weight: number;
    /** Line height as a multiple of the body font size; the result is a whole pixel. */
    leading: number;
    justify: boolean;
    /** Largest extra space added to one word gap when a line is stretched, in em. */
    maxStretch: number;
    /** Largest space removed from one word gap when a line is squeezed, in em. */
    maxShrink: number;
    hyphenate: boolean;
    /** First-line indent in em. The first paragraph of the piece and a paragraph that follows a
     *  crosshead or an object set at its anchor are flush. */
    indent: number;
    /** Blank lines between paragraphs. */
    paragraphGap: number;
    /** Drop cap on the first body paragraph, `lines` tall. */
    dropCap: {
        lines: number;
        family?: string;
        weight?: number;
    } | null;
    /** Fewest lines of a paragraph allowed at the top of a column. */
    widows: number;
    /** Fewest lines of a paragraph allowed at the bottom of a column. */
    orphans: number;
    /** On the first page, the column body text starts in, leaving the earlier ones to the opening
     *  objects. Ignored when the page has no more than this many columns. Default 0. */
    openingColumn?: number;
    crosshead: TypeStyle & {
        spaceBefore: number;
    };
}
export interface Placement {
    /** First column the object occupies, 0-based; negative counts from the last column
     *  (`-1` = last). `'anchor'` = the column the text is flowing in when the anchor is reached. */
    column: number | 'anchor';
    /** Columns spanned, clamped to the columns that exist from `column`. */
    span: number | 'all';
    /** `'anchor'` = at the flow position when the anchor is reached. */
    vertical: 'top' | 'middle' | 'bottom' | 'anchor';
    /** Occupy only part of the spanned width, hugging one side; text runs beside it. */
    inset?: {
        side: 'start' | 'end';
        fraction: number;
    };
    /** Clear space kept between the object and text, in lines. */
    clearance: number;
}
export type ObjectHeight = 
/** As tall as its fitted text. Text objects only. */
{
    kind: 'text';
}
/** `width / ratio`. A media block's own `aspect` wins. */
 | {
    kind: 'aspect';
    ratio: number;
} | {
    kind: 'lines';
    lines: number;
}
/** From its top down to the bottom of the frame. */
 | {
    kind: 'fill';
};
export type FitMode = 
/** `style.scale` sets the size; text wraps inside the box. */
{
    kind: 'none';
}
/** One size for all lines, chosen so the widest line fills the box width. */
 | {
    kind: 'width';
    lines: number | 'auto';
    maxLines: number;
    maxScale: number;
}
/** Every line scaled on its own to fill the box width. */
 | {
    kind: 'lines';
    lines: number | 'auto';
    maxLines: number;
    maxScale: number;
}
/** `style.scale` sets the size; letter spacing stretches one line to the box width. */
 | {
    kind: 'tracking';
}
/** Largest size between the two scales whose wrapped text fits the box height. The object's
 *  height must not be `text`. */
 | {
    kind: 'box';
    minScale: number;
    maxScale: number;
};
export interface RoleRule {
    /** Type of a text object. Ignored for media objects. */
    style?: TypeStyle;
    fit: FitMode;
    place: Placement;
    height: ObjectHeight;
    /** Most of the frame height the object may take, as a fraction (default 1). It is the height
     *  budget a fit mode works within, so a fitted headline cannot swallow the page. */
    maxHeight?: number;
}
export interface FlowSpec {
    id: string;
    grid: GridSpec;
    body: BodySpec;
    /** A role with no rule is set at its anchor, one column wide. */
    roles: Partial<Record<ObjectRole, RoleRule>>;
    /** Order in which the opening objects are stacked on the first page, by role. Roles not listed
     *  follow in document order. Default: kicker, headline, deck, byline, hero, badge. */
    openingOrder?: ObjectRole[];
    /** What changes when there is little room. Applied when the grid resolves to `columns` columns
     *  or fewer: each role's rule and the body spec are shallow-merged with these (a `place`,
     *  `fit`, `height` or `style` given here replaces the whole one). The grid is not re-resolved,
     *  so `body.family`, `body.weight` and `body.leading` given here are ignored. */
    compact?: {
        columns: number;
        roles?: Partial<Record<ObjectRole, Partial<RoleRule>>>;
        body?: Partial<BodySpec>;
        openingOrder?: ObjectRole[];
    };
}
export interface MeasureItem {
    text: string;
    font: FontSpec;
}
/** Opaque handle to a prepared paragraph. */
export interface PreparedParagraph {
    readonly __preparedParagraph: true;
}
/** Opaque position inside a prepared paragraph. Pass back only. */
export interface LineCursor {
    readonly __lineCursor: true;
}
export interface MeasuredFragment {
    /** Index into the items the paragraph was prepared from. */
    itemIndex: number;
    /** Text to paint. Trailing spaces of a line's last fragment are already removed. */
    text: string;
    /** Collapsed space before this fragment, px. */
    gapBefore: number;
    width: number;
    sourceStart: number;
    sourceEnd: number;
}
export interface MeasuredLine {
    /** Width of the painted line, hanging spaces excluded, the hyphen of a soft-hyphen break
     *  included. */
    width: number;
    fragments: MeasuredFragment[];
    /** Where the next line starts. */
    end: LineCursor;
    /** The line ends at a soft hyphen and paints a hyphen. */
    hyphenated: boolean;
}
export interface FontMetrics {
    ascent: number;
    descent: number;
    capHeight: number;
}
/** Everything the engine asks of a text measurer. `createPretextMeasurer()` is the real one. */
export interface Measurer {
    prepare(items: MeasureItem[]): PreparedParagraph;
    /** The next line no wider than `maxWidth`, from `start` (omit for the paragraph start), or
     *  `null` when the paragraph is exhausted. A word wider than `maxWidth` is cut between
     *  graphemes, so a positive `maxWidth` always makes progress. */
    nextLine(prepared: PreparedParagraph, maxWidth: number, start?: LineCursor): MeasuredLine | null;
    /** True when no text remains after `cursor`. Cheap: it must not lay the remainder out. */
    atEnd(prepared: PreparedParagraph, cursor: LineCursor): boolean;
    lineStats(prepared: PreparedParagraph, maxWidth: number): {
        lineCount: number;
        maxLineWidth: number;
    };
    /** Width of `text` on one line. */
    naturalWidth(text: string, font: FontSpec): number;
    /** Vertical metrics in px for that font at its size. */
    metrics(font: FontSpec): FontMetrics;
    /** Forget every cached width and metric. Call after a web font finishes loading: anything
     *  measured before was measured in the fallback font. Prepared paragraphs become stale. */
    invalidate(): void;
}
/** Returns `word` with U+00AD at every allowed break. */
export type Hyphenator = (word: string) => string;
export type FlowMode = 'paged-x' | 'paged-y';
export interface BodyGrid {
    font: FontSpec;
    /** Whole px. The baseline unit. */
    lineHeight: number;
    columns: number;
    /** Whole px. */
    columnWidth: number;
    /** Column gap in px, a whole number of px. */
    gap: number;
    /** Margins in px. */
    margin: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    /** Estimated characters per line at this size and column width. */
    charsPerLine: number;
}
export interface PageGeometry {
    index: number;
    /** The page in flow coordinates. */
    rect: Rect;
    /** One rect per column, left to right. Heights are a whole number of lines. In an unbounded
     *  page the height is `Infinity`. */
    frames: Rect[];
}
export interface FittedLine {
    /** Text as painted (upper-cased when the style asks for it). */
    text: string;
    /** UTF-16 offsets of the source characters this line paints, in the object's source text —
     *  its runs' texts concatenated as passed in. For a drop cap: in its paragraph's run `run`. */
    start: number;
    end: number;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Distance from the line's top (`y`) down to its alphabetic baseline. Paint by this, not by
     *  centring the text in its box: faces differ in how they sit in a line box. */
    baseline: number;
    font: FontSpec;
}
export interface FittedText {
    /** Lines positioned relative to the box's top-left. */
    lines: FittedLine[];
    width: number;
    height: number;
    /** The text could not fit the box at the smallest size allowed. */
    clipped: boolean;
}
export interface PlacedFragment {
    text: string;
    /** Left edge relative to the line's `x`, before word spacing is applied. */
    x: number;
    width: number;
    /** Collapsed space between the previous fragment and this one, px; 0 when they touch. A
     *  fragment with a gap before it counts as one word gap. */
    gapBefore: number;
    /** The font this fragment was measured in and must be painted in. */
    font: FontSpec;
    em: boolean;
    strong: boolean;
    href?: string;
    /** Index of the run this text comes from, in the paragraph's `runs` as passed in. */
    run: number;
    /** UTF-16 offsets, in that run's text AS PASSED IN, of the source characters this fragment
     *  paints: `start` is the offset of its first source character, `end` one past its last. The
     *  painted `text` is the source slice after the engine's transformations — whitespace
     *  collapsed, upper-cased in an upper-case style, soft hyphens dropped, a hyphen added at a
     *  hyphenated line end — so the two can differ in length. Fragments of a paragraph are in
     *  source order and do not overlap, with one exception: when a single source character is
     *  painted as several (`ß` → `SS` in an upper-case style) and a line breaks between them,
     *  both fragments include that character. A range never splits a surrogate pair. */
    start: number;
    end: number;
}
export interface PlacedLine {
    /** Index of the source block in `doc.blocks`. */
    block: number;
    blockId: string;
    role: 'body' | 'crosshead';
    page: number;
    column: number;
    /** Top-left of the line box, in flow coordinates (not relative to its page or frame). */
    x: number;
    y: number;
    /** Distance from `y` down to the alphabetic baseline. */
    baseline: number;
    /** Natural width of the text. */
    width: number;
    /** Width the line was allowed. `width <= slotWidth` unless `wordSpacing` is negative. */
    slotWidth: number;
    height: number;
    /** The roman font of the line; `em` / `strong` fragments paint its italic / bold. */
    font: FontSpec;
    fragments: PlacedFragment[];
    /** Word gaps in the line: spaces inside fragments plus fragments with a `gapBefore`. */
    gaps: number;
    /** Px added to every word gap: positive stretches, negative squeezes, 0 leaves it ragged. */
    wordSpacing: number;
    justified: boolean;
    first: boolean;
    last: boolean;
    hyphenated: boolean;
}
export interface PlacedObject {
    /** Index of the source block in `doc.blocks`; for a drop cap, its paragraph's. */
    block: number;
    id: string;
    role: ObjectRole | 'dropcap';
    kind: 'text' | 'media' | 'dropcap';
    page: number;
    /** Box in flow coordinates; `y` and `height` sit on the baseline grid. */
    rect: Rect;
    /** Text objects and drop caps: lines relative to `rect`'s top-left. */
    lines?: FittedLine[];
    src?: string;
    alt?: string;
    /** Drop caps: the run its letter comes from, and the link that run belongs to, if any. */
    run?: number;
    href?: string;
    /** The object did not get the size its rule asked for. */
    clipped: boolean;
}
export interface PageLayout {
    index: number;
    rect: Rect;
    frames: Rect[];
    /** In reading order: column by column, top to bottom. */
    lines: PlacedLine[];
    /** In the order they were placed. Use `block` to find an object's place in reading order. */
    objects: PlacedObject[];
}
export interface FlowLayout {
    specId: string;
    mode: FlowMode;
    viewport: Size;
    /** Size of the whole flow: pages × viewport along the paging axis. */
    extent: Size;
    body: BodyGrid;
    pages: PageLayout[];
    stats: {
        lines: number;
        justified: number;
        ragged: number;
        hyphenated: number;
        objects: number;
        clippedObjects: number;
        /** Ids of objects that could not be placed at all. */
        droppedObjects: string[];
        /** Pages the engine had to lay out as unbounded because paging made no progress. 0 in a
         *  healthy layout. */
        fallbackPages: number;
    };
}
export interface FlowEnvironment {
    /** The window the flow is read through. In `paged-x` every page is one viewport wide and
     *  tall. In `paged-y` every page is one viewport wide and — when there are two or more
     *  columns — one viewport tall; with a single column the page is unbounded. */
    viewport: Size;
    mode: FlowMode;
    measurer: Measurer;
    /** Applied to body paragraphs when `spec.body.hyphenate` is set. */
    hyphenator?: Hyphenator | null;
}
