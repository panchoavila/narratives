import * as React from 'react';
export type SplitTextScope = {
    query: string;
} | {
    variant: string;
};
/** Structurally `TextAnimConfig` from the builder (canvas-poc/src/editor/tools/
 *  AnimationTool/motion/text-anim-presets.ts). Kept in sync by a type-assignability
 *  test in canvas-poc — a field added there without a counterpart here fails the build. */
export interface SplitTextSpec {
    /** STRUCTURAL — resolved from the BASE spec only, never from a scope override, so the
     *  emitted tree is identical on server and client. */
    animationType?: 'character' | 'word' | 'line' | 'full';
    /** STRUCTURAL — wraps each unit in an overflow-hidden clip ("cut-off" reveal). */
    mask?: boolean;
    /** STRUCTURAL — when the reveal plays (Framer's Trigger):
     *  'appear'  = On Appear: as soon as it mounts, wherever it is on the page.
     *  'view'    = Layer in View (default): when the text's top reaches `viewport`.
     *  'section' = Section in View: when `sectionId`'s top reaches `viewport`.
     *  'scroll'  = scrubbed to scroll progress (scrollStart / scrollEnd). */
    trigger?: 'appear' | 'view' | 'section' | 'scroll';
    /** Layer / Section in View — the viewport line the top edge must cross:
     *  top of the viewport, its middle, or its bottom (default: as soon as it enters). */
    viewport?: 'top' | 'middle' | 'bottom';
    /** Layer / Section in View — play again every time it re-enters (hide when it leaves). */
    replay?: boolean;
    /** Section in View — the id of the section that triggers the reveal. */
    sectionId?: string;
    /** Per-scope existence switch — a VALUE field, so a `responsive` scope can
     *  turn the effect off (or back on) for one breakpoint/variant. Disabled
     *  renders the SAME split DOM with no motion: structure stays identical
     *  across scopes, which is what keeps server and client trees agreeing. */
    disabled?: boolean;
    /** Scroll mode only — viewport position (% from top) where the reveal starts / completes. */
    scrollStart?: number;
    scrollEnd?: number;
    /** Scroll mode only — the share of the scrub each unit spans, as a fraction of the whole
     *  range. Default 0.4: units overlap and the reveal reads as a soft gradient across the
     *  text. 0 = one unit at a time (1/count each, no overlap): a sharp per-word step, which is
     *  how Framer's Text Scroll Reveal reads. Pair with a spring `transition` and the step lands
     *  with the spring's own snap. */
    scrollWindow?: number;
    opacity?: number;
    scale?: number;
    blur?: number;
    rotateX?: number;
    rotateY?: number;
    rotateZ?: number;
    skewX?: number;
    skewY?: number;
    /** Strings keep their unit. '100%' resolves against the unit's OWN box, which is what
     *  makes a masked reveal correct at every type size — a px offset masks correctly at
     *  one breakpoint only. */
    x?: number | string;
    y?: number | string;
    /** Stagger between units, seconds. */
    delay?: number;
    transition?: {
        type?: 'spring' | 'tween';
        stiffness?: number;
        damping?: number;
        mass?: number;
        duration?: number;
        bounce?: number;
        ease?: string | number[];
        /** Initial delay before the first unit, seconds. */
        delay?: number;
    };
    /** Per-viewport / per-variant value overrides. First match wins (matches the builder's
     *  `resolveTextAnimForScope`). Structural fields in an override are ignored. */
    responsive?: Array<{
        scope: SplitTextScope;
        config: Partial<SplitTextSpec>;
    }>;
}
export interface RevymeSplitTextProps {
    spec?: SplitTextSpec;
    /** Active component variant — only needed when `spec.responsive` has `{variant}` scopes. */
    variant?: string;
    children?: React.ReactNode;
}
export declare function RevymeSplitText({ spec, variant, children }: RevymeSplitTextProps): React.ReactElement;
export default RevymeSplitText;
