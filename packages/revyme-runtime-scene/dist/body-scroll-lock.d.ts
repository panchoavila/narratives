import { type HTMLAttributes } from 'react';
export interface BodyScrollLockProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    active?: boolean;
    static?: boolean;
}
/** A nonvisual, reference-counted page scroll lock for transient overlays. */
export declare function RevymeBodyScrollLock({ active, static: isStatic, style, ...rest }: BodyScrollLockProps): import("react/jsx-runtime").JSX.Element;
