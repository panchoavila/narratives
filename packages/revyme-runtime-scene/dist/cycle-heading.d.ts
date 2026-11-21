import { type AdvancedHeadingProps } from './advanced-heading';
export interface CycleHeadingProps extends Omit<AdvancedHeadingProps, 'text' | 'effect' | 'trigger'> {
    /** One phrase per line. */
    phrases?: string;
    pauseDuration?: number;
    mode?: 'scramble' | 'stagger';
    staggerDelay?: number;
    exitStaggerDelay?: number;
    easing?: 'smooth' | 'framer';
}
/** Rotating semantic copy with the same scramble engine as Advanced Heading. */
export declare function RevymeCycleHeading({ phrases, pauseDuration, mode, staggerDelay, exitStaggerDelay, easing, static: isStatic, ...props }: CycleHeadingProps): import("react/jsx-runtime").JSX.Element;
