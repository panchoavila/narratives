import { type HTMLAttributes } from 'react';
import { CORNER_STYLES, PATTERN_PRESETS } from './advanced-config';
export interface AdvancedFrameProps extends HTMLAttributes<HTMLDivElement> {
    fillColor?: string;
    cornerStyle?: typeof CORNER_STYLES[number];
    cornerSize?: number;
    cornerStroke?: number;
    cornerColor?: string;
    cornerFill?: string;
    cornerOffsetX?: number;
    cornerOffsetY?: number;
    patternPreset?: typeof PATTERN_PRESETS[number];
    patternColor?: string;
    tileSize?: number;
    lineWidth?: number;
    dotSize?: number;
    flip?: boolean;
    customPatternImage?: string;
    customPatternSizing?: 'fill' | 'fit' | 'stretch' | 'tile';
    customPatternPosition?: string;
    customPatternMode?: 'alpha' | 'luminance';
    patternMotion?: 'none' | 'shimmer';
    patternDuration?: number;
    compositionMaskImage?: string;
    compositionMaskMode?: 'alpha' | 'luminance';
    compositionMaskSizing?: 'fill' | 'fit' | 'stretch' | 'tile';
    compositionMaskPosition?: string;
    compositionMaskTileSize?: number;
    static?: boolean;
}
/** Native children retain layout, focus and events; decoration never participates in layout or input. */
export declare function RevymeAdvancedFrame(props: AdvancedFrameProps): import("react/jsx-runtime").JSX.Element;
