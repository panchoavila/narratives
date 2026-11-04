import { type ComponentType } from 'react';
export type CursorMode = 'follow' | 'replace';
export type CursorSide = 'top' | 'bottom' | 'left' | 'right';
export type CursorAlign = 'start' | 'center' | 'end';
export interface CursorTransition {
    type?: 'spring' | 'tween' | 'instant';
    stiffness?: number;
    damping?: number;
    mass?: number;
    duration?: number;
    ease?: string;
}
export interface CursorOpts<P = any> {
    variant?: string;
    mode?: CursorMode;
    /**
     * Which side of the mouse the cursor wrapper anchors to (Follow mode).
     * Replace mode ignores side / align / offset — it auto-centers on the mouse.
     */
    side?: CursorSide;
    /**
     * Alignment along the perpendicular axis to `side`.
     * top/bottom: start = left, center = horizontal center, end = right.
     * left/right: start = top,  center = vertical center,   end = bottom.
     */
    align?: CursorAlign;
    offsetX?: number;
    offsetY?: number;
    transition?: CursorTransition;
    props?: Partial<P>;
    /**
     * Wrapper width / height applied to the cursor's outer motion.div. Useful
     * for code components (canvases, sparks) that fill their parent — without
     * this they'd render at their intrinsic size, which is often the whole
     * viewport. Plain numbers are interpreted as px; pass a string ('100%',
     * '4rem') to use other CSS units.
     */
    width?: number | string;
    height?: number | string;
    /**
     * When true, fade/scale on enter and exit via AnimatePresence. Default
     * false: appear and disappear instantly. The follow movement is always
     * smoothed by the spring config above — `enterExit` only controls the
     * mount/unmount transition.
     */
    enterExit?: boolean;
}
/**
 * Spread the return value into an element to give it a component cursor.
 * Returns onMouseEnter/onMouseLeave handlers that push/pop the global store.
 *
 * <button {...withCursor(Pointer, { mode: 'follow', transition: { type: 'spring', stiffness: 300 } })}>
 */
export declare function withCursor<P>(Component: ComponentType<P>, opts?: CursorOpts<P>): {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
};
export declare function CursorPortal(): import("react/jsx-runtime").JSX.Element | null;
