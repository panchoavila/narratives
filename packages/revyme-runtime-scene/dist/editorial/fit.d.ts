import type { FittedText, FitMode, FontSpec, InlineRun, Measurer, TypeStyle } from './types';
export declare function fitText(runs: InlineRun[], rawStyle: TypeStyle, rawFit: FitMode, box: {
    width: number;
    maxHeight: number;
}, bodySize: number, measurer: Measurer): FittedText;
/** The baseline of a line of height `h` in a font: centred on the font's ascent and descent. */
export declare function baselineIn(measurer: Measurer, font: FontSpec, height: number): number;
