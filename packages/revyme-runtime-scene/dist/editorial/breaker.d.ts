import { type Piece } from './source';
import type { BodyGrid, BodySpec, FontSpec, Hyphenator, InlineRun, LineCursor, Measurer, MeasuredLine, ParagraphBlock, PlacedFragment, PreparedParagraph } from './types';
export interface DropCapPlan {
    /** The painted letters. */
    text: string;
    font: FontSpec;
    /** Columns of reserved width, whole px. */
    reserved: number;
    /** Rows the cap spans, at most. */
    rows: number;
    /** Natural width of the cap text. */
    natural: number;
    /** The run the letters come from, and their source span in it. */
    run: number;
    span: {
        start: number;
        end: number;
    };
    /** The link the run belongs to, when it has one (B11). */
    href?: string;
}
/** What a drop cap is made of, before its size is chosen: its letters, their run and span, the link
 *  they belong to, and the face the cap is set in. */
export interface CapSource {
    text: string;
    run: number;
    span: {
        start: number;
        end: number;
    };
    href?: string;
    family: string;
    weight: number;
}
export interface ParagraphVariant {
    /** The runs as measured: their marks, with `text` the transformed text. */
    runs: InlineRun[];
    /** Per run, the transformed text with its source map. */
    pieces: Piece[];
    prepared: PreparedParagraph;
}
export interface ParagraphPlan {
    id: string;
    role: 'body' | 'crosshead';
    /** The roman font of the paragraph's lines. */
    font: FontSpec;
    /** Whole rows one line occupies: 1 for body lines, the crosshead's rows otherwise. */
    rows: number;
    /** Lines of the paragraph at the frame width, for keep-with-next. */
    plain: ParagraphVariant;
    /** The variant with the drop cap's letters removed, when a cap applies. */
    capped: ParagraphVariant | null;
    dropCap: DropCapPlan | null;
    /** The letters and face a cap of any height is made from (E3). */
    capSource: CapSource | null;
    /** The variant the paragraph's lines are currently laid with. */
    variant: 'plain' | 'capped';
}
export interface PlanInput {
    block: ParagraphBlock;
    body: BodySpec;
    grid: BodyGrid;
    measurer: Measurer;
    hyphenator: Hyphenator | null;
    /** The drop cap applies only to the first body paragraph of the piece. */
    dropCapAllowed: boolean;
}
/** Font of one run: the paragraph's base font with the run's em and strong marks applied. */
export declare function variantFont(base: FontSpec, run: InlineRun): FontSpec;
/** Lays out the preparation of one paragraph: runs (whitespace collapsed, upper-cased for an
 *  upper-case crosshead, hyphenated for body text), fonts, the prepared variants and the drop cap. */
/** The drop cap of `src` set over `rows` lines (E3): its font size, reserved width and natural width
 *  are all worked out for those rows. The glyph's cap height spans from the top row's cap line to the
 *  baseline of the last row. */
export declare function dropCapAt(src: CapSource, rows: number, grid: BodyGrid, measurer: Measurer): DropCapPlan;
export declare function planParagraph(input: PlanInput): ParagraphPlan;
/** Word gaps of a line: U+0020 and U+00A0 inside its fragments (the characters CSS `word-spacing`
 *  stretches), plus fragments that start after a gap (C11). */
export declare function gapCount(line: MeasuredLine): number;
/** True when nothing follows the line in its paragraph (B8: asked of the measurer, never by laying
 *  the remainder out). */
export declare function isLastLine(measurer: Measurer, prepared: PreparedParagraph, line: MeasuredLine): boolean;
/**
 * The line that starts at `cursor` in a slot of `slot` px. With `squeeze` (justified body text) a
 * squeezed candidate is also tried; it wins when it is admissible, is not the paragraph's last line,
 * and costs less per gap than stretching the natural line.
 */
export declare function chooseLine(measurer: Measurer, prepared: PreparedParagraph, slot: number, cursor: LineCursor | undefined, body: BodySpec, size: number, squeeze: boolean): MeasuredLine | null;
/** Word spacing that makes a line fill its slot, and whether it is within the stretch or shrink
 *  limits. A last line, a line without gaps, or a spec without justification is never justified. */
export declare function justify(line: MeasuredLine, slot: number, body: BodySpec, size: number, gaps: number, last: boolean, enabled: boolean): {
    wordSpacing: number;
    justified: boolean;
};
/** Fragments of a measured line: positions before word spacing, the font each is painted in, its
 *  run, and its source span (C3). */
export declare function placedFragments(line: MeasuredLine, variant: ParagraphVariant, base: FontSpec): PlacedFragment[];
/** Keeps the concatenation helper in use for object text (fit): the pieces of several runs. */
export declare function joinPieces(pieces: Piece[]): Piece;
