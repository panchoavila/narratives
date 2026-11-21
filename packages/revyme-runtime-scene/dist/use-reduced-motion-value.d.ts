import { type MotionValue } from 'framer-motion';
/** Preserve the source and other spatial transforms while resting this animated channel under reduced motion. */
export declare function useReducedMotionValue<T extends number | string>(source: MotionValue<T>, fallback: T, _authored?: boolean): MotionValue<T>;
