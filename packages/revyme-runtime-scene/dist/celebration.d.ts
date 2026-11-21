import { type HTMLAttributes } from 'react';
export interface ConfettiProps extends HTMLAttributes<HTMLDivElement> {
    colors?: string[] | string;
    density?: number;
    size?: number;
    speed?: number;
    delay?: number;
    sizeVariance?: number;
    speedVariance?: number;
    flip?: number;
    flipVariance?: number;
    swayIntensity?: number;
    dragIntensity?: number;
    lengthFactor?: number;
    explode?: boolean;
    explodeDistance?: number;
    static?: boolean;
}
/** Decorative, finite particle burst; no work in static/reduced-motion modes. */
export declare function RevymeConfetti({ colors, density, size, speed, delay, sizeVariance, speedVariance, flip, flipVariance, swayIntensity, dragIntensity, lengthFactor, explode, explodeDistance, static: isStatic, style, ...props }: ConfettiProps): import("react/jsx-runtime").JSX.Element;
