import { type HTMLAttributes } from 'react';
export interface AlternatingRowsProps extends HTMLAttributes<HTMLDivElement> {
    targetId?: string;
    itemTargetId?: string;
    parity?: 'even' | 'odd';
    direction?: 'row-reverse' | 'column-reverse';
    enabled?: boolean;
    itemPinnedTargetId?: string;
    pinFrom?: 'top' | 'right' | 'bottom' | 'left';
    pinTo?: 'top' | 'right' | 'bottom' | 'left';
    pinOffset?: number;
}
export declare function alternatingRowsCss(scope: string, targetId: string, itemTargetId: string, parity: 'even' | 'odd', direction: 'row-reverse' | 'column-reverse', itemPinnedTargetId?: string, pinFrom?: string, pinTo?: string, pinOffset?: number): string;
/** Persistent layout treatment; the children remain native editable elements. */
export declare function RevymeAlternatingRows({ children, targetId, itemTargetId, parity, direction, enabled, itemPinnedTargetId, pinFrom, pinTo, pinOffset, style, ...props }: AlternatingRowsProps): import("react/jsx-runtime").JSX.Element;
