import { type HTMLAttributes, type ReactNode } from 'react';
import { type EditorialPiece } from './document';
import { type EditorialPresetId, type EditorialTheme } from './presets';
import type { FlowLayout, FlowMode, FlowSpec } from './types';
export interface RevymeFlowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    piece: EditorialPiece;
    /** A built-in layout. Ignored when `spec` is given; an unknown id falls back to `cover-story`. */
    preset?: EditorialPresetId | string;
    /** A layout of your own. */
    spec?: FlowSpec;
    /** The faces the piece is set in. */
    theme: EditorialTheme;
    /** Language of the text: hyphenation patterns and line-breaking rules. */
    locale?: string;
    /** How pages follow each other. `paged-y`: down the page; `paged-x`: across, each page one
     *  window of the host — the host's width, and its height when it has one (else the viewport's),
     *  the pages after the first overflowing to the right and reserved by a box after the host.
     *  `auto` follows the page: across where the page's `--revyme-page-flow` is `horizontal` (Page
     *  Flow sets it per breakpoint), down elsewhere, read again on every layout. */
    mode?: FlowMode | 'auto';
    /** Colour of the pages. */
    paper?: string;
    /** Colour of the text. */
    ink?: string;
    /** Colour of the rule between pages. */
    rule?: string;
    /** Number the pages in their bottom margin. */
    folios?: boolean;
    /** Called with every layout the component paints. */
    onLayout?: (layout: FlowLayout) => void;
    /** Rendered on the Revyme editor canvas: pages are sized to the device the canvas tile
     *  simulates, not to the editor's own window. */
    inCanvas?: boolean;
    /** Free-form elements that join the flow: each is placed like a picture, by the settings in its
     *  `data-flow` attribute (see `flow-attr.ts`), and painted inside the box the layout gives it. */
    children?: ReactNode;
}
/** Fired on the window after every layout a flow paints, so the page's scroll controller can
 *  measure the page again (its width changes with the number of pages). */
export declare const FLOW_LAYOUT_EVENT = "revyme:layout";
export declare function RevymeFlow({ piece, preset, spec: ownSpec, theme, locale, mode, paper, ink, rule, folios, onLayout, inCanvas, children, className, style, ...rest }: RevymeFlowProps): import("react/jsx-runtime").JSX.Element;
