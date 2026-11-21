import { type HTMLAttributes } from 'react';
export interface SmartEyeProps extends HTMLAttributes<HTMLDivElement> {
    eyeImage?: string;
    irisImage?: string;
    eyeWidth?: number;
    eyeHeight?: number;
    irisWidth?: number;
    irisHeight?: number;
    trackingIntensity?: number;
    verticalIntensity?: number;
    static?: boolean;
}
/** Pointer tracking matches the original Smart_Eye window-based spring mapping. */
export declare function RevymeSmartEye({ eyeImage, irisImage, eyeWidth, eyeHeight, irisWidth, irisHeight, trackingIntensity: _trackingIntensity, verticalIntensity, static: isStatic, style, ...props }: SmartEyeProps): import("react/jsx-runtime").JSX.Element;
