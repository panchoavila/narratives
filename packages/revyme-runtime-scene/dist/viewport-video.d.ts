import { type VideoHTMLAttributes } from 'react';
export interface ViewportVideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'children'> {
    fit?: 'cover' | 'contain' | 'fill';
    playInView?: boolean;
    static?: boolean;
}
/** Real video with viewport-driven playback. The poster remains visible if autoplay fails. */
export declare function RevymeViewportVideo({ src, poster, fit, playInView, controls, muted, loop, static: isStatic, style, ...props }: ViewportVideoProps): import("react/jsx-runtime").JSX.Element;
