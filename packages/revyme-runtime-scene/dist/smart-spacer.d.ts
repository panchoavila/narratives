import { type HTMLAttributes } from 'react';
type DimensionSource = 'targetWidth' | 'targetHeight' | 'none';
export interface SmartSpacerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    sourceMode?: 'id' | 'selector';
    targetId?: string;
    targetSelector?: string;
    widthFrom?: DimensionSource;
    heightFrom?: DimensionSource;
    wScale?: number;
    hScale?: number;
    wOffset?: number;
    hOffset?: number;
    wMin?: number;
    hMin?: number;
    wMax?: number;
    hMax?: number;
    fallbackWidth?: number;
    fallbackHeight?: number;
    preferFallbackInCanvas?: boolean;
    background?: string;
    static?: boolean;
}
/** Dimension spacer observing a named target, with deterministic SSR/static fallback. */
export declare function RevymeSmartSpacer({ sourceMode, targetId, targetSelector, widthFrom, heightFrom, wScale, hScale, wOffset, hOffset, wMin, hMin, wMax, hMax, fallbackWidth, fallbackHeight, preferFallbackInCanvas, background, static: isStatic, style, ...props }: SmartSpacerProps): import("react/jsx-runtime").JSX.Element;
export {};
