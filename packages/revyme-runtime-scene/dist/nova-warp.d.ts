import { type HTMLAttributes } from 'react';
import { type NovaWarpConfig } from './nova-warp-config';
export interface NovaWarpProps extends Partial<NovaWarpConfig>, HTMLAttributes<HTMLDivElement> {
    static?: boolean;
}
/** Decorative GPU background. HTML stays live and retains ownership of clicks, focus and scroll. */
export declare function RevymeNovaWarp(props: NovaWarpProps): import("react/jsx-runtime").JSX.Element;
