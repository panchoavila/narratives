import { type HTMLAttributes } from 'react';
export interface ImageLightboxProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    src?: string;
    fullSrc?: string;
    alt?: string;
    fit?: 'cover' | 'contain' | 'fill';
    radius?: number;
    padding?: number;
    maxWidth?: number;
    backdropColor?: string;
    stiffness?: number;
    damping?: number;
    mass?: number;
    openLabel?: string;
    closeLabel?: string;
    static?: boolean;
}
/** Native top-layer dialog preserves focus and escapes ancestor clipping/transforms. */
export declare function RevymeImageLightbox({ src, fullSrc, alt, fit, radius, padding, maxWidth, backdropColor, stiffness, damping, mass, openLabel, closeLabel, static: isStatic, style, ...props }: ImageLightboxProps): import("react/jsx-runtime").JSX.Element;
