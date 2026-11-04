export type SketchAnimMode = 'sequential' | 'staggered' | 'simultaneous';
export type SketchAnimTrigger = 'mount' | 'inView' | 'hover' | 'tap';
export interface SketchAnimTransition {
    type: 'tween' | 'spring';
    duration?: number;
    ease?: string;
    stiffness?: number;
    damping?: number;
    mass?: number;
}
export interface SketchAnimOpts {
    trigger?: SketchAnimTrigger;
    mode?: SketchAnimMode;
    /** Multiplier on per-stroke duration. Per-stroke duration scales
     *  with point count so a long stroke takes longer than a flick;
     *  this dials the overall pace. */
    durationScale?: number;
    /** 0–1, only meaningful in staggered mode. 0 = fully sequential,
     *  1 = fully simultaneous. */
    stagger?: number;
    transition?: SketchAnimTransition;
    /** Brush size used for the intermediate-frame outline replay. The
     *  final-frame `d` is restored from source so the end state is
     *  pixel-exact regardless of this value. */
    brushSize?: number;
}
/**
 * Play a sketch draw animation on the given wrapper SVG. Pass the
 * options the generator emitted in source.
 *
 * Returns a cleanup function — wire as your useEffect's return value
 * so re-mounts cancel an in-flight animation cleanly:
 *
 *   useEffect(() => playSketchDraw(svgEl, opts), []);
 *
 * If `wrapperEl` is null or the wrapper has no path children with
 * `data-points`, this is a no-op and returns a noop cleanup.
 */
export declare function playSketchDraw(wrapperEl: SVGSVGElement | null, userOpts?: SketchAnimOpts): () => void;
