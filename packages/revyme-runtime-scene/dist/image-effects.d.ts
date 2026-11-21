import { type HTMLAttributes } from 'react';
export interface PixelRevelationProps extends HTMLAttributes<HTMLDivElement> {
    image?: string;
    alt?: string;
    imageFit?: 'cover' | 'contain' | 'fill';
    duration?: number;
    steps?: number;
    startPixelSize?: number;
    delay?: number;
    replay?: boolean;
    static?: boolean;
}
export interface DitherProps extends HTMLAttributes<HTMLDivElement> {
    image?: string;
    alt?: string;
    imageFit?: 'cover' | 'contain' | 'fill';
    threshold?: number;
    brightness?: number;
    midtones?: number;
    pixelSize?: number;
    backgroundColor?: string;
    dotColor?: string;
    enabled?: boolean;
    static?: boolean;
}
/** A real nearest-neighbor pixel reveal over the semantic image; CORS failure leaves the image intact. */
export declare function RevymePixelRevelation({ image, alt, imageFit, duration, steps, startPixelSize, delay, replay, static: isStatic, style, ...props }: PixelRevelationProps): import("react/jsx-runtime").JSX.Element;
/** Ordered 4×4 Bayer dither. The original image stays available on image/CORS/canvas failure. */
export declare function RevymeDither({ image, alt, imageFit, threshold, brightness, midtones, pixelSize, backgroundColor, dotColor, enabled, static: _isStatic, style, ...props }: DitherProps): import("react/jsx-runtime").JSX.Element;
